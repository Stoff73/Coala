import { describe, expect, it } from "vitest";
import { retailAssistantAgent } from "@coala/core";
import { MockProvider } from "@coala/providers";
import { AgentRuntime, InMemoryStore, ToolRegistry } from "../index.js";

/** A provider that returns a fixed sequence of responses, one per call. */
function scripted(responses: string[]): MockProvider {
  let i = 0;
  return new MockProvider([
    { match: () => true, text: () => responses[Math.min(i++, responses.length - 1)]! },
  ]);
}

describe("InMemoryStore retrieval", () => {
  const store = new InMemoryStore([
    { text: "blue running shoes", importance: 1 },
    { text: "red leather boots", importance: 5 },
    { text: "running socks", importance: 2 },
  ]);

  it("recency returns the most recent first", () => {
    const r = store.retrieve({ text: "", method: "recency", k: 2 });
    expect(r.map((x) => x.text)).toEqual(["running socks", "red leather boots"]);
  });

  it("importance ranks by the importance field", () => {
    const r = store.retrieve({ text: "", method: "importance", k: 1 });
    expect(r[0]!.text).toBe("red leather boots");
  });

  it("relevance ranks by keyword overlap", () => {
    const r = store.retrieve({ text: "running shoes", method: "relevance", k: 2 });
    expect(r[0]!.text).toBe("blue running shoes");
    expect(r.every((x) => String(x.text).includes("running"))).toBe(true);
  });
});

describe("AgentRuntime decision cycle", () => {
  it("retrieves, calls a tool, writes to episodic memory, then responds", async () => {
    const provider = scripted([
      JSON.stringify({
        thought: "Search the catalog for the request.",
        action: { type: "grounding", tool: "searchCatalog", args: { query: "running shoes" } },
      }),
      JSON.stringify({
        thought: "Record this interaction in history.",
        action: {
          type: "learning",
          memoryModuleId: "mem-history",
          record: { customerId: "c1", query: "running shoes", timestamp: "2026-01-01" },
        },
      }),
      JSON.stringify({
        thought: "Answer the user.",
        action: { type: "respond", message: "Here are some running shoes: Trail Runner ($120)." },
      }),
    ]);

    const tools = new ToolRegistry().register("searchCatalog", (args) => [
      { name: "Trail Runner", price: 120, q: args.query },
    ]);

    const runtime = new AgentRuntime(retailAssistantAgent, provider, tools, { maxSteps: 6 });
    const result = await runtime.runTurn("I need running shoes");

    expect(result.reply).toBe("Here are some running shoes: Trail Runner ($120).");
    expect(result.steps).toHaveLength(3);

    // Step 1: grounding tool ran and produced an observation.
    expect(result.steps[0]!.action.type).toBe("grounding");
    expect(result.steps[0]!.observation).toEqual([{ name: "Trail Runner", price: 120, q: "running shoes" }]);

    // Retrieval ran over both readable long-term modules (catalog + history).
    expect(result.steps[0]!.retrieved.map((r) => r.moduleName).sort()).toEqual([
      "Customer interactions",
      "Product catalog",
    ]);

    // Step 2: a learning write landed in episodic memory.
    expect(result.steps[1]!.memoryWrite?.moduleId).toBe("mem-history");
    expect(runtime.stores.get("mem-history")!.records).toHaveLength(1);

    // Step 3: terminal response.
    expect(result.steps[2]!.terminal).toBe(true);
  });

  it("blocks a learning write to a read-only module (enforces the access policy)", async () => {
    const provider = scripted([
      JSON.stringify({
        thought: "Try to edit the inventory.",
        action: { type: "learning", memoryModuleId: "mem-catalog", record: { name: "fake" } },
      }),
      JSON.stringify({ thought: "Done.", action: { type: "respond", message: "ok" } }),
    ]);

    const runtime = new AgentRuntime(retailAssistantAgent, provider, new ToolRegistry());
    const result = await runtime.runTurn("add a product");

    expect(result.steps[0]!.blocked).toMatch(/not writable/);
    // The read-only catalog store was not mutated.
    expect(runtime.stores.get("mem-catalog")!.records).toHaveLength(0);
  });

  it("respects maxSteps when the agent never terminates", async () => {
    const provider = scripted([
      JSON.stringify({
        thought: "loop",
        action: { type: "grounding", tool: "searchCatalog", args: {} },
      }),
    ]);
    const tools = new ToolRegistry().register("searchCatalog", () => ["x"]);
    const runtime = new AgentRuntime(retailAssistantAgent, provider, tools, { maxSteps: 3 });
    const result = await runtime.runTurn("loop forever");
    expect(result.steps).toHaveLength(3);
    expect(result.reply).toBeNull();
  });
});
