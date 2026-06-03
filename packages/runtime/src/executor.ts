import { z } from "zod";
import type { Agent } from "@coala/core";
import type { Store } from "@coala/core";
import type { EmbeddingProvider, LLMProvider } from "@coala/providers";
import {
  WorkingMemory,
  buildStores,
  moduleById,
  type Record_,
} from "./memory.js";
import { ToolRegistry } from "./tools.js";
import { EmbeddingIndex } from "./embedding.js";
import { ActionProposal } from "./schema.js";
import { actionTargets, reasonRequest } from "./prompt.js";
import type { CycleStep, RetrievedItem, TurnResult } from "./trace.js";

const EpisodeCaptureSchema = z.object({
  data: z.record(z.string(), z.unknown()),
  rubricScores: z.record(z.string(), z.unknown()).default({}),
  reflection: z.string().default(""),
});

/** Register the built-in `memory.open` tool: pull one record body by moduleId + id. */
export function registerMemoryOpen(tools: ToolRegistry, stores: Map<string, Store>): void {
  tools.register("memory.open", async (args) => {
    const moduleId = String((args as Record<string, unknown>).moduleId ?? "");
    const id = String((args as Record<string, unknown>).id ?? "");
    const store = stores.get(moduleId);
    if (!store) return { error: `Unknown module "${moduleId}".` };
    const body = await store.openBody(id);
    return body ?? { error: `No record "${id}" in "${moduleId}".` };
  });
}

export interface RuntimeOptions {
  /** Safety bound on cycles per turn (prevents runaway loops). */
  maxSteps?: number;
  /** Embedder enabling real vector ("embedding") retrieval; falls back to keyword if absent. */
  embedder?: EmbeddingProvider;
  /** Pre-built stores (e.g. FileStore from @coala/agent-fs). Defaults to in-memory. */
  stores?: Map<string, Store>;
  /** After a turn, write a rubric-scored trajectory to a writable episodic module. */
  captureEpisodes?: boolean;
}

/**
 * Executes a CoALA blueprint's decision cycle (paper §4.6) against an LLM provider.
 * Each cycle: retrieve relevant long-term memory → reason to propose an action →
 * execute it (grounding tool / learning write / dialogue response).
 */
export class AgentRuntime {
  readonly working = new WorkingMemory();
  readonly stores: Map<string, Store>;
  private readonly embeddingIndex?: EmbeddingIndex;

  constructor(
    private readonly agent: Agent,
    private readonly provider: LLMProvider,
    private readonly tools: ToolRegistry = new ToolRegistry(),
    private readonly opts: RuntimeOptions = {},
  ) {
    this.stores = opts.stores ?? buildStores(agent);
    registerMemoryOpen(this.tools, this.stores);
    if (opts.embedder) this.embeddingIndex = new EmbeddingIndex(opts.embedder);
  }

  /** Long-term modules the agent may read, with their retrieval method. */
  private retrievalGrants() {
    return this.agent.accessPolicy
      .filter((a) => a.retrieval.enabled)
      .map((a) => ({ grant: a, module: moduleById(this.agent, a.memoryModuleId) }))
      .filter((x): x is { grant: typeof x.grant; module: NonNullable<typeof x.module> } => !!x.module);
  }

  private async retrieve(query: string): Promise<RetrievedItem[]> {
    const items: RetrievedItem[] = [];
    for (const { grant, module } of this.retrievalGrants()) {
      const store = this.stores.get(module.id);
      if (!store) continue;
      const method = grant.retrieval.method ?? module.retrievalConfig?.method ?? "relevance";
      const k = module.retrievalConfig?.k ?? 5;
      let records: Record_[];
      if (method === "embedding" && this.embeddingIndex) {
        const pointers = await store.listPointers();
        const winners = await this.embeddingIndex.rankPointers(pointers, query, k);
        records = [];
        for (const p of winners) {
          const body = await store.openBody(p.id);
          if (body) records.push(body);
        }
      } else {
        records = await store.retrieve({ text: query, method, k });
      }
      items.push({ moduleId: module.id, moduleName: module.name, method, records });
    }
    return items;
  }

  /** Run one conversational turn: cycles until the agent responds/finishes. */
  async runTurn(input: string): Promise<TurnResult> {
    this.working.set("input", input);
    const targets = actionTargets(this.agent);
    const maxSteps = this.opts.maxSteps ?? 6;
    const steps: CycleStep[] = [];
    let reply: string | null = null;

    for (let step = 1; step <= maxSteps; step++) {
      const retrieved = await this.retrieve(input);
      this.working.set("retrieved", retrieved);

      const proposal = await this.provider.completeStructured(
        reasonRequest(this.agent, this.working, targets),
        ActionProposal,
      );
      const action = proposal.action;

      const entry: CycleStep = { step, retrieved, thought: proposal.thought, action, terminal: false };

      switch (action.type) {
        case "respond": {
          reply = action.message ?? "";
          entry.terminal = true;
          break;
        }
        case "finish": {
          reply = reply ?? action.result ?? null;
          entry.terminal = true;
          break;
        }
        case "grounding": {
          const obs = await this.tools.run(action.tool ?? "", action.args ?? {}, { working: this.working });
          entry.observation = obs;
          this.working.set("lastObservation", obs);
          break;
        }
        case "learning": {
          const write = await this.applyLearning(action.memoryModuleId, action.record ?? {});
          if (typeof write === "string") entry.blocked = write;
          else entry.memoryWrite = write;
          break;
        }
      }

      steps.push(entry);
      if (entry.terminal) break;
    }

    let capturedEpisode: { moduleId: string; pointerId: string } | undefined;
    if (this.opts.captureEpisodes) {
      try {
        capturedEpisode = await this.captureEpisode(input, reply, steps);
      } catch (err) {
        // Reflection is best-effort; log and swallow so the reply is never lost.
        console.warn("[AgentRuntime] episodic capture failed (turn reply preserved):", err);
      }
    }
    return { reply, steps, capturedEpisode };
  }

  /** First writable episodic module (learning.add) the agent has, if any. */
  private episodicTarget() {
    for (const grant of this.agent.accessPolicy) {
      if (!grant.learning.add) continue;
      const module = moduleById(this.agent, grant.memoryModuleId);
      if (module?.kind === "episodic") return module;
    }
    return undefined;
  }

  /** Make one structured LLM call to score the turn against the module's rubric, then persist it. */
  private async captureEpisode(input: string, reply: string | null, steps: CycleStep[]): Promise<{ moduleId: string; pointerId: string } | undefined> {
    const module = this.episodicTarget();
    const store = module && this.stores.get(module.id);
    if (!module || !store) return undefined;
    const rubric = module.rubric ?? { criteria: [], reflectionPrompts: [] };

    const request = {
      model: this.agent.providerConfig.model,
      system: "You record a past episode into episodic memory. Score it against the rubric and reflect honestly.",
      messages: [{
        role: "user" as const,
        content:
          `User said: ${input}\nAgent replied: ${reply ?? "(none)"}\n` +
          `Steps: ${JSON.stringify(steps.map((s) => ({ thought: s.thought, action: s.action })))}\n` +
          `Rubric criteria: ${JSON.stringify(rubric.criteria)}\n` +
          `Reflection prompts: ${JSON.stringify(rubric.reflectionPrompts)}\n` +
          `Return JSON { "data": {...the episode trajectory...}, "rubricScores": {...}, "reflection": "..." }.`,
      }],
    };
    const ep = await this.provider.completeStructured(request, EpisodeCaptureSchema);
    const ptr = await store.add(
      { ...ep.data, rubricScores: ep.rubricScores },
      { source: "runtime", body: ep.reflection ? `## Reflection\n${ep.reflection}\n` : "" },
    );
    return { moduleId: module.id, pointerId: ptr.id };
  }

  /** Apply a learning (write) action, enforcing the agent's access policy. */
  private async applyLearning(moduleId: string | undefined, record: Record_) {
    if (!moduleId) return "No memoryModuleId provided.";
    const grant = this.agent.accessPolicy.find((a) => a.memoryModuleId === moduleId);
    if (!grant?.learning.add) return `Module "${moduleId}" is not writable (no learning grant).`;
    const store = this.stores.get(moduleId);
    const module = moduleById(this.agent, moduleId);
    if (!store || !module) return `Module "${moduleId}" has no store.`;
    await store.add(record);
    return { moduleId, moduleName: module.name, record };
  }
}
