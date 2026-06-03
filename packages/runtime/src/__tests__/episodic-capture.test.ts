import { describe, it, expect } from "vitest";
import { MockProvider } from "@coala/providers";
import { InMemoryStore } from "../memory.js";
import { AgentRuntime } from "../executor.js";
import type { Agent } from "@coala/core";

// Minimal agent with a writable episodic module that has a rubric.
const agent = {
  id: "a", name: "A", naturalLanguageSpec: "", goals: [],
  providerConfig: { provider: "local", model: "x" },
  memoryModules: [
    { id: "wm", kind: "working", name: "W", description: "", backingStore: { type: "kv" }, records: [] },
    { id: "proc", kind: "procedural", name: "P", description: "", backingStore: { type: "code" }, records: [] },
    { id: "ep", kind: "episodic", name: "Episodes", description: "", backingStore: { type: "inline" }, records: [],
      rubric: { criteria: [{ name: "resolved", description: "?" }], reflectionPrompts: ["What did the user want?"] } },
  ],
  groundingInterfaces: [{ type: "dialogue" }],
  accessPolicy: [{ memoryModuleId: "ep", retrieval: { enabled: true, method: "recency" }, learning: { add: true, modify: false, delete: false } }],
  decisionProcedure: { style: "react", planning: {}, executionPolicy: "" },
  metadata: { version: 0 },
} as unknown as Agent;

describe("episodic capture", () => {
  it("writes a rubric-scored episode after the turn when captureEpisodes is on", async () => {
    const provider = new MockProvider([
      // The capture/reflection call — matched by a distinctive marker in its system prompt.
      { match: (req) => (req.system ?? "").includes("record a past episode"),
        text: JSON.stringify({ data: { observation: "user greeted", action: "respond", result: "Hello!" }, rubricScores: { resolved: true }, reflection: "User wanted a greeting." }) },
      // The turn's decision call — catch-all.
      { match: () => true,
        text: JSON.stringify({ thought: "reply", action: { type: "respond", message: "Hello!" } }) },
    ]);
    const ep = new InMemoryStore([]);
    const rt = new AgentRuntime(agent, provider, undefined, { stores: new Map([["ep", ep]]), captureEpisodes: true });
    await rt.runTurn("hi");
    expect(await ep.listPointers()).toHaveLength(1);
  });

  it("does NOT capture when captureEpisodes is off (default)", async () => {
    const provider = new MockProvider([
      { match: () => true, text: JSON.stringify({ thought: "reply", action: { type: "respond", message: "Hi" } }) },
    ]);
    const ep = new InMemoryStore([]);
    const rt = new AgentRuntime(agent, provider, undefined, { stores: new Map([["ep", ep]]) });
    await rt.runTurn("hi");
    expect(await ep.listPointers()).toHaveLength(0);
  });
});
