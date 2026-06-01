import type { Agent } from "@coala/core";
import type { EmbeddingProvider, LLMProvider } from "@coala/providers";
import {
  InMemoryStore,
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

export interface RuntimeOptions {
  /** Safety bound on cycles per turn (prevents runaway loops). */
  maxSteps?: number;
  /** Embedder enabling real vector ("embedding") retrieval; falls back to keyword if absent. */
  embedder?: EmbeddingProvider;
}

/**
 * Executes a CoALA blueprint's decision cycle (paper §4.6) against an LLM provider.
 * Each cycle: retrieve relevant long-term memory → reason to propose an action →
 * execute it (grounding tool / learning write / dialogue response).
 */
export class AgentRuntime {
  readonly working = new WorkingMemory();
  readonly stores: Map<string, InMemoryStore>;
  private readonly embeddingIndex?: EmbeddingIndex;

  constructor(
    private readonly agent: Agent,
    private readonly provider: LLMProvider,
    private readonly tools: ToolRegistry = new ToolRegistry(),
    private readonly opts: RuntimeOptions = {},
  ) {
    this.stores = buildStores(agent);
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
      // Real vector retrieval when an embedder is available; otherwise keyword fallback.
      const records =
        method === "embedding" && this.embeddingIndex
          ? await this.embeddingIndex.rank(store.records, query, k)
          : store.retrieve({ text: query, method, k });
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
          const write = this.applyLearning(action.memoryModuleId, action.record ?? {});
          if (typeof write === "string") entry.blocked = write;
          else entry.memoryWrite = write;
          break;
        }
      }

      steps.push(entry);
      if (entry.terminal) break;
    }

    return { reply, steps };
  }

  /** Apply a learning (write) action, enforcing the agent's access policy. */
  private applyLearning(moduleId: string | undefined, record: Record_) {
    if (!moduleId) return "No memoryModuleId provided.";
    const grant = this.agent.accessPolicy.find((a) => a.memoryModuleId === moduleId);
    if (!grant?.learning.add) return `Module "${moduleId}" is not writable (no learning grant).`;
    const store = this.stores.get(moduleId);
    const module = moduleById(this.agent, moduleId);
    if (!store || !module) return `Module "${moduleId}" has no store.`;
    store.add(record);
    return { moduleId, moduleName: module.name, record };
  }
}
