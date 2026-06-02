import { describe, expect, it } from "vitest";
import { Agent } from "../schema/agent.js";
import { lintAgent } from "../invariants/lint.js";
import { reactAgent } from "../presets/react.js";

/** Clone a preset and mutate it for a single negative case. */
function mutate(fn: (a: Agent) => void): Agent {
  const clone: Agent = Agent.parse(JSON.parse(JSON.stringify(reactAgent)));
  fn(clone);
  return clone;
}

const ruleNames = (a: Agent) => lintAgent(a).findings.map((f) => f.rule);

describe("CoALA invariants", () => {
  it("errors when procedural memory is missing", () => {
    const a = mutate((x) => {
      x.memoryModules = x.memoryModules.filter((m) => m.kind !== "procedural");
    });
    expect(lintAgent(a).ok).toBe(false);
    expect(ruleNames(a)).toContain("procedural-memory-required");
  });

  it("errors when working memory is missing", () => {
    const a = mutate((x) => {
      x.memoryModules = x.memoryModules.filter((m) => m.kind !== "working");
    });
    expect(ruleNames(a)).toContain("working-memory-required");
  });

  it("errors when there is no grounding interface", () => {
    const a = mutate((x) => {
      x.groundingInterfaces = [];
    });
    expect(ruleNames(a)).toContain("grounding-required");
  });

  it("errors when an access grant references an unknown module", () => {
    const a = mutate((x) => {
      x.accessPolicy = [
        { memoryModuleId: "ghost", retrieval: { enabled: false }, learning: { add: false, modify: false, delete: false } },
      ];
    });
    expect(ruleNames(a)).toContain("access-references-existing-module");
  });

  it("errors when retrieval is enabled without a method", () => {
    const a = mutate((x) => {
      x.accessPolicy = [
        { memoryModuleId: "mem-procedural", retrieval: { enabled: true }, learning: { add: false, modify: false, delete: false } },
      ];
    });
    expect(ruleNames(a)).toContain("retrieval-requires-method");
  });

  it("errors when learning targets working memory", () => {
    const a = mutate((x) => {
      x.accessPolicy = [
        { memoryModuleId: "mem-working", retrieval: { enabled: false }, learning: { add: true, modify: false, delete: false } },
      ];
    });
    expect(ruleNames(a)).toContain("learning-targets-long-term-memory");
  });

  it("warns on unlearning (delete) grants", () => {
    const a = mutate((x) => {
      x.accessPolicy = [
        { memoryModuleId: "mem-procedural", retrieval: { enabled: false }, learning: { add: false, modify: false, delete: true } },
      ];
    });
    const findings = lintAgent(a).findings;
    expect(findings.some((f) => f.rule === "unlearning-safety" && f.severity === "warning")).toBe(true);
  });

  it("a clean preset reports ok", () => {
    expect(lintAgent(reactAgent).ok).toBe(true);
  });

  it("warns (heuristic) on an untagged tool whose name looks destructive", () => {
    const a = mutate((x) => {
      x.groundingInterfaces[0]!.type = "digital";
      x.groundingInterfaces[0]!.digitalTools = [
        { name: "delete_record", description: "" },
      ];
    });
    const f = lintAgent(a).findings;
    expect(f.some((x) => x.rule === "destructive-tool-safety" && x.severity === "warning")).toBe(true);
  });

  it("warns on a tool explicitly tagged destructive", () => {
    const a = mutate((x) => {
      x.groundingInterfaces[0]!.type = "digital";
      x.groundingInterfaces[0]!.digitalTools = [
        { name: "ship", description: "Send the order", sideEffect: "destructive" },
      ];
    });
    expect(ruleNames(a)).toContain("destructive-tool-safety");
  });

  it("does NOT warn when a destructive-looking tool is explicitly tagged read", () => {
    const a = mutate((x) => {
      x.groundingInterfaces[0]!.type = "digital";
      x.groundingInterfaces[0]!.digitalTools = [
        { name: "remove_filter", description: "remove a UI filter (no external effect)", sideEffect: "read" },
      ];
    });
    expect(ruleNames(a)).not.toContain("destructive-tool-safety");
  });

  it("does NOT warn on an innocuous untagged tool", () => {
    const a = mutate((x) => {
      x.groundingInterfaces[0]!.type = "digital";
      x.groundingInterfaces[0]!.digitalTools = [
        { name: "searchCatalog", description: "Search products" },
      ];
    });
    expect(ruleNames(a)).not.toContain("destructive-tool-safety");
  });
});
