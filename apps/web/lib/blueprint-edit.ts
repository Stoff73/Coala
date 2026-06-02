import type {
  AccessGrant,
  Agent,
  BackingStoreType,
  EpisodeRubric,
  GroundingInterface,
  MemoryKind,
  MemoryModule,
} from "@coala/core";

/** A sensible default episode rubric for a new episodic store. */
export function newRubric(): EpisodeRubric {
  return {
    criteria: [
      { name: "Goal achieved", description: "" },
      { name: "Efficiency", description: "few cycles, no wasted tools" },
      { name: "Tool-use correctness", description: "" },
      { name: "Memory hygiene", description: "right reads/writes, policy respected" },
      { name: "Faithfulness to intent", description: "" },
    ],
    reflectionPrompts: ["What worked?", "What to avoid next time?", "New facts learned?"],
  };
}

let counter = 0;
const uid = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export function backingStoreFor(kind: MemoryKind): BackingStoreType {
  switch (kind) {
    case "working":
      return "kv";
    case "procedural":
      return "code";
    case "episodic":
    case "semantic":
      return "pgvector";
  }
}

/** A fresh memory module of the given kind, with sensible defaults. */
export function newModule(kind: MemoryKind): MemoryModule {
  const label = kind.charAt(0).toUpperCase() + kind.slice(1);
  const structured = kind === "semantic" || kind === "episodic";
  return {
    id: uid("mem"),
    kind,
    name: `${label} memory`,
    description: "",
    schema: structured ? { title: "Record", fields: [] } : undefined,
    retrievalConfig: structured ? { method: "relevance" } : undefined,
    backingStore: { type: backingStoreFor(kind) },
    records: [],
  };
}

export function newGrounding(): GroundingInterface {
  return {
    id: uid("ground"),
    type: "digital",
    name: "New interface",
    description: "",
    digitalTools: [],
  };
}

export function emptyGrant(memoryModuleId: string): AccessGrant {
  return {
    memoryModuleId,
    retrieval: { enabled: false },
    learning: { add: false, modify: false, delete: false },
  };
}

/**
 * Read-or-create the access grant for a module, mutate it, then drop it if it became empty.
 * Shared by the board's Access matrix and the Memory screen's plain access controls.
 */
export function applyGrant(
  update: (fn: (d: Agent) => void) => void,
  moduleId: string,
  mutate: (g: AccessGrant) => void,
): void {
  update((d) => {
    let g = d.accessPolicy.find((x) => x.memoryModuleId === moduleId);
    if (!g) {
      g = emptyGrant(moduleId);
      d.accessPolicy.push(g);
    }
    mutate(g);
    if (g.retrieval.enabled && !g.retrieval.method) g.retrieval.method = "relevance";
    const empty = !g.retrieval.enabled && !g.learning.add && !g.learning.modify && !g.learning.delete;
    if (empty) d.accessPolicy = d.accessPolicy.filter((x) => x.memoryModuleId !== moduleId);
  });
}
