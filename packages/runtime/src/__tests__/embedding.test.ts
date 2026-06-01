import { describe, expect, it } from "vitest";
import { type Agent, retailAssistantAgent } from "@coala/core";
import { LocalEmbeddingProvider, MockProvider } from "@coala/providers";
import { AgentRuntime, EmbeddingIndex, ToolRegistry, cosine } from "../index.js";

describe("cosine", () => {
  it("is 1 for identical and 0 for orthogonal", () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
  });
});

describe("EmbeddingIndex", () => {
  it("ranks the semantically-closest record first", async () => {
    const index = new EmbeddingIndex(new LocalEmbeddingProvider());
    const records = [
      { name: "blue leather boots" },
      { name: "trail running shoes" },
      { name: "wool winter socks" },
    ];
    const ranked = await index.rank(records, "shoes for running", 2);
    expect(ranked[0]!.name).toBe("trail running shoes");
  });
});

describe("AgentRuntime with an embedder", () => {
  it("uses real embedding retrieval for the 'embedding' method", async () => {
    // Seed the catalog (semantic, retrieval=embedding) with records.
    const agent: Agent = structuredClone(retailAssistantAgent);
    const catalog = agent.memoryModules.find((m) => m.name === "Product catalog")!;
    catalog.records = [
      { id: "p1", data: { name: "blue leather boots" }, source: "seed" },
      { id: "p2", data: { name: "trail running shoes" }, source: "seed" },
      { id: "p3", data: { name: "wool winter socks" }, source: "seed" },
    ];

    const provider = new MockProvider([
      { match: () => true, text: () => JSON.stringify({ thought: "ok", action: { type: "respond", message: "done" } }) },
    ]);
    const runtime = new AgentRuntime(agent, provider, new ToolRegistry(), {
      embedder: new LocalEmbeddingProvider(),
    });

    const res = await runtime.runTurn("I want running shoes");
    const catalogItem = res.steps[0]!.retrieved.find((r) => r.moduleName === "Product catalog")!;
    expect(catalogItem.method).toBe("embedding");
    expect((catalogItem.records[0] as { name: string }).name).toBe("trail running shoes");
  });
});
