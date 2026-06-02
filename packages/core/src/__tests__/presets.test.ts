import { describe, expect, it } from "vitest";
import { Agent } from "../schema/agent.js";
import { lintAgent } from "../invariants/lint.js";
import { PRESETS, getPreset } from "../presets/index.js";

describe("Table 2 presets", () => {
  it("ships all six archetypes", () => {
    expect(PRESETS).toHaveLength(6);
    expect(PRESETS.map((p) => p.metadata.preset).sort()).toEqual([
      "generative-agents",
      "react",
      "retail-assistant",
      "saycan",
      "tree-of-thoughts",
      "voyager",
    ]);
  });

  it.each(PRESETS.map((p) => [p.name, p] as const))(
    "%s validates against the Agent schema",
    (_name, preset) => {
      expect(() => Agent.parse(preset)).not.toThrow();
    },
  );

  it.each(PRESETS.map((p) => [p.name, p] as const))(
    "%s lints with zero errors",
    (_name, preset) => {
      const result = lintAgent(preset);
      const errors = result.findings.filter((f) => f.severity === "error");
      expect(errors, JSON.stringify(errors, null, 2)).toHaveLength(0);
      expect(result.ok).toBe(true);
    },
  );

  it("no preset trips the destructive-tool heuristic", () => {
    for (const agent of PRESETS) {
      const hits = lintAgent(agent).findings.filter(
        (f) => f.rule === "destructive-tool-safety",
      );
      expect(
        hits,
        `${agent.name} unexpectedly flagged: ${hits.map((h) => h.message).join("; ")}`,
      ).toHaveLength(0);
    }
  });

  it("getPreset resolves by metadata key", () => {
    expect(getPreset("react")?.name).toBe("ReAct");
    expect(getPreset("nope")).toBeUndefined();
  });
});

describe("expected CoALA warnings", () => {
  it("flags Voyager's procedural-write as a safety warning", () => {
    const voyager = getPreset("voyager")!;
    const rules = lintAgent(voyager).findings.map((f) => f.rule);
    expect(rules).toContain("procedural-write-safety");
  });
});
