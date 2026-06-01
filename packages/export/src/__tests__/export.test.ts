import { describe, expect, it } from "vitest";
import { PRESETS, parseAgent, reactAgent, retailAssistantAgent } from "@coala/core";
import {
  blueprintJsonSchema,
  bundleAgent,
  generateCode,
  listAdapters,
  listEmitters,
  parseBlueprint,
  scaffoldMemory,
  toBlueprintJSON,
  toBlueprintYAML,
} from "../index.js";

describe("neutral blueprint serializers", () => {
  it("round-trips every preset through JSON", () => {
    for (const agent of PRESETS) {
      const restored = parseBlueprint(toBlueprintJSON(agent), "json");
      expect(restored).toEqual(parseAgent(agent));
    }
  });

  it("round-trips through YAML", () => {
    const restored = parseBlueprint(toBlueprintYAML(retailAssistantAgent), "yaml");
    expect(restored.name).toBe("Retail Assistant");
    expect(restored.memoryModules.map((m) => m.kind).sort()).toEqual([
      "episodic",
      "procedural",
      "semantic",
      "working",
    ]);
  });

  it("publishes a JSON Schema object", () => {
    const schema = blueprintJsonSchema();
    expect(typeof schema).toBe("object");
    expect(JSON.stringify(schema)).toContain("memoryModules");
  });
});

describe("codegen adapters", () => {
  it("lists registered adapters", () => {
    expect(listAdapters().map((a) => a.id).sort()).toEqual(["langgraph", "typescript"]);
  });

  it("TypeScript adapter emits an agent stub + blueprint json", () => {
    const files = generateCode(retailAssistantAgent, "typescript");
    expect(files.map((f) => f.path)).toEqual([
      "retail-assistant.agent.ts",
      "retail-assistant.blueprint.json",
    ]);
    const ts = files[0]!.content;
    expect(ts).toContain("class RetailAssistantAgent");
    expect(ts).toContain("searchCatalog");
    expect(ts).toContain("decisionCycle");
  });

  it("LangGraph adapter emits a StateGraph with the enabled stages", () => {
    const files = generateCode(retailAssistantAgent, "langgraph");
    const py = files[0]!.content;
    expect(py).toContain("StateGraph");
    expect(py).toContain('graph.add_node("propose"');
    expect(py).toContain('graph.add_node("evaluate"'); // retail enables evaluation
    expect(py).toContain('graph.add_node("execute"');
  });

  it("ReAct (propose-only) omits evaluate/select nodes", () => {
    const py = generateCode(reactAgent, "langgraph")[0]!.content;
    expect(py).toContain('graph.add_node("propose"');
    expect(py).not.toContain('graph.add_node("evaluate"');
    expect(py).not.toContain('graph.add_node("select"');
  });

  it("throws on an unknown adapter", () => {
    expect(() => generateCode(reactAgent, "nope")).toThrow(/Unknown codegen adapter/);
  });
});

describe("runnable-agent bundles", () => {
  it("registers all seven target languages", () => {
    expect(listEmitters().map((e) => e.id).sort()).toEqual([
      "csharp",
      "go",
      "java",
      "php",
      "python",
      "ruby",
      "typescript",
    ]);
  });

  it("every emitter produces a complete project including blueprint + tools", () => {
    for (const { id } of listEmitters()) {
      const files = bundleAgent(retailAssistantAgent, id);
      const paths = files.map((f) => f.path);
      expect(paths).toContain("blueprint.json");
      // the blueprint round-trips back to the same agent
      const bp = files.find((f) => f.path === "blueprint.json")!;
      expect(parseBlueprint(bp.content).name).toBe("Retail Assistant");
      // a tools file is generated and references the agent's digital tool
      const tools = files.find((f) => /tools|Tools/.test(f.path) && f.path !== "blueprint.json");
      expect(tools, `${id} has a tools file`).toBeTruthy();
      expect(tools!.content).toContain("searchCatalog");
      // a README is included
      expect(paths.some((p) => p.toLowerCase().includes("readme"))).toBe(true);
    }
  });

  it("throws on an unknown language", () => {
    expect(() => bundleAgent(reactAgent, "cobol")).toThrow(/Unknown language/);
  });

  it("bundles include the documented memory/ scaffold", () => {
    const paths = bundleAgent(retailAssistantAgent, "python").map((f) => f.path);
    expect(paths).toContain("memory/README.md");
    expect(paths.some((p) => p.startsWith("memory/semantic/"))).toBe(true);
  });
});

describe("memory scaffold", () => {
  it("produces per-kind docs, an episode rubric, and procedural templates", () => {
    const files = scaffoldMemory(retailAssistantAgent);
    const paths = files.map((f) => f.path);

    expect(paths).toContain("memory/README.md");
    // retail = semantic (catalog) + episodic (history) + working + procedural
    expect(paths.some((p) => /^memory\/semantic\/.+\.md$/.test(p))).toBe(true);
    expect(paths.some((p) => /^memory\/episodic\/.+\.md$/.test(p))).toBe(true);
    // episodic store gets a rubric template
    const rubric = files.find((f) => f.path.endsWith(".rubric.md"));
    expect(rubric, "episode rubric").toBeTruthy();
    expect(rubric!.content).toContain("Rubric scores");
    expect(rubric!.content).toContain("Reflection");
    // procedural gets prompt + skill templates
    expect(paths.some((p) => /procedural\/.+\/prompts\/.+\.md$/.test(p))).toBe(true);
    expect(paths.some((p) => /procedural\/.+\/skills\/SKILL_TEMPLATE\.md$/.test(p))).toBe(true);
  });

  it("README lists every module in the access matrix", () => {
    const readme = scaffoldMemory(retailAssistantAgent).find((f) => f.path === "memory/README.md")!;
    expect(readme.content).toContain("Product catalog");
    expect(readme.content).toContain("Customer interactions");
    expect(readme.content).toContain("Decision procedure");
  });

  it("emits the user's edited rubric and procedural content", () => {
    const agent = parseAgent(retailAssistantAgent);
    const episodic = agent.memoryModules.find((m) => m.kind === "episodic")!;
    episodic.rubric = {
      criteria: [{ name: "Custom criterion XYZ", description: "my dimension" }],
      reflectionPrompts: ["My custom reflection?"],
    };
    const procedural = agent.memoryModules.find((m) => m.kind === "procedural")!;
    procedural.procedural = {
      templates: [{ name: "My Reasoner", content: "REASON LIKE THIS" }],
      skills: [{ name: "fetchOrders", description: "get orders", code: "return db.orders" }],
    };

    const files = scaffoldMemory(agent);
    const rubric = files.find((f) => f.path.endsWith(".rubric.md"))!.content;
    expect(rubric).toContain("Custom criterion XYZ");
    expect(rubric).toContain("My custom reflection?");

    const tmpl = files.find((f) => /procedural\/.+\/prompts\/my-reasoner\.md$/.test(f.path));
    expect(tmpl?.content).toContain("REASON LIKE THIS");
    const skill = files.find((f) => /procedural\/.+\/skills\/fetchorders\.md$/.test(f.path));
    expect(skill?.content).toContain("return db.orders");
  });
});
