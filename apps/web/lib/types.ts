import type { Agent, Finding, MemoryKind } from "@coala/core";

/** Shape returned by /api/infer and (per preset) /api/presets. */
export interface BlueprintResult {
  agent: Agent;
  findings: Finding[];
  ok: boolean;
}

export const MEMORY_KIND_META: Record<
  MemoryKind,
  { label: string; plain: string; cls: string }
> = {
  working: {
    label: "Working",
    plain: "Short-term scratchpad",
    cls: "text-working border-working/40 bg-working/10",
  },
  episodic: {
    label: "Episodic",
    plain: "Past experiences",
    cls: "text-episodic border-episodic/40 bg-episodic/10",
  },
  semantic: {
    label: "Semantic",
    plain: "Facts & knowledge",
    cls: "text-semantic border-semantic/40 bg-semantic/10",
  },
  procedural: {
    label: "Procedural",
    plain: "Code & skills",
    cls: "text-procedural border-procedural/40 bg-procedural/10",
  },
};
