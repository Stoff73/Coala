import {
  type Agent,
  type BackingStoreType,
  type MemoryKind,
  type ProviderConfig,
  type RetrievalMethod,
  parseAgent,
} from "@coala/core";
import type { InferenceInput } from "./prompts.js";
import type {
  AccessPassOutput,
  DecisionPassOutput,
  MemoryPassOutput,
} from "./schemas.js";

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "module"
  );
}

/** Default runtime backing store per memory kind (Phase 2 wiring; sensible defaults now). */
function backingStoreFor(kind: MemoryKind): BackingStoreType {
  switch (kind) {
    case "working":
      return "kv";
    case "procedural":
      return "code";
    case "episodic":
    case "semantic":
      return "pgvector";
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

export interface AssembleInput extends InferenceInput {
  providerConfig: ProviderConfig;
  agentId?: string;
}

/**
 * Combine the three pass outputs into a canonical CoALA blueprint. Guarantees the
 * CoALA-required working + procedural modules exist, assigns stable ids, wires
 * retrieval methods, and defends against common LLM omissions (e.g. read access
 * without a retrieval method). Validates via parseAgent before returning.
 */
export function assembleAgent(
  input: AssembleInput,
  mem: MemoryPassOutput,
  acc: AccessPassOutput,
  dec: DecisionPassOutput,
): Agent {
  const modules = [...mem.modules];
  if (!modules.some((m) => m.kind === "working")) {
    modules.unshift({
      kind: "working",
      name: "Working memory",
      description: "Short-term hub carried across the decision cycle.",
      rationale: "Required by CoALA; added automatically.",
    });
  }
  if (!modules.some((m) => m.kind === "procedural")) {
    modules.push({
      kind: "procedural",
      name: "Agent code + LLM",
      description: "Prompt templates, parsers, and the LLM itself.",
      rationale: "Required by CoALA; added automatically.",
    });
  }

  const usedIds = new Set<string>();
  const idFor = (name: string): string => {
    const base = `mem-${slug(name)}`;
    let id = base;
    let i = 2;
    while (usedIds.has(id)) id = `${base}-${i++}`;
    usedIds.add(id);
    return id;
  };

  const nameToId = new Map<string, string>();
  const kindById = new Map<string, MemoryKind>();

  const findGrant = (name: string) =>
    acc.grants.find((g) => g.moduleName.toLowerCase() === name.toLowerCase());

  const memoryModules = modules.map((m) => {
    const id = idFor(m.name);
    nameToId.set(m.name.toLowerCase(), id);
    kindById.set(id, m.kind);

    const isLtm = m.kind !== "working";
    const grant = findGrant(m.name);
    // If the module is read-enabled, ensure a method (default relevance) so it stays lint-clean.
    const method: RetrievalMethod | undefined =
      isLtm && grant?.read ? (grant.retrievalMethod ?? "relevance") : undefined;

    return {
      id,
      kind: m.kind,
      name: m.name,
      description: m.description,
      rationale: m.rationale,
      schema: m.recordSchema
        ? { title: m.recordSchema.title, fields: m.recordSchema.fields }
        : undefined,
      retrievalConfig: method ? { method } : undefined,
      backingStore: { type: backingStoreFor(m.kind) },
      records: [],
    };
  });

  // Internal action space — skip working-memory grants and empty no-op grants.
  const accessPolicy = acc.grants.flatMap((g) => {
    const id = nameToId.get(g.moduleName.toLowerCase());
    if (!id) return [];
    if (kindById.get(id) === "working") return [];
    const writes = g.add || g.modify || g.delete;
    if (!g.read && !writes) return [];
    return [
      {
        memoryModuleId: id,
        retrieval: {
          enabled: !!g.read,
          method: g.read ? (g.retrievalMethod ?? "relevance") : undefined,
        },
        learning: { add: g.add, modify: g.modify, delete: g.delete },
      },
    ];
  });

  const groundingInterfaces = dec.grounding.map((gr) => ({
    id: `ground-${slug(gr.name)}`,
    type: gr.type,
    name: gr.name,
    description: gr.description,
    digitalTools:
      gr.type === "digital" && gr.tools
        ? gr.tools.map((t) => ({ name: t.name, description: t.description }))
        : [],
  }));

  return parseAgent({
    id: input.agentId ?? `agent-${slug(input.name)}`,
    name: input.name,
    naturalLanguageSpec: input.naturalLanguageSpec,
    goals: mem.goals,
    providerConfig: input.providerConfig,
    memoryModules,
    groundingInterfaces,
    accessPolicy,
    decisionProcedure: {
      style: dec.style,
      planning: {
        proposal: dec.proposal,
        evaluation: dec.evaluation,
        selection: dec.selection,
      },
      reasoningTemplates: [],
      executionPolicy: dec.executionPolicy,
    },
    metadata: { version: 0 },
  });
}
