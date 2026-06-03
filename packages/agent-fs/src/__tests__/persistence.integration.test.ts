import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockProvider } from "@coala/providers";
import { AgentRuntime } from "@coala/runtime";
import type { Agent } from "@coala/core";
import { saveAgentFolder, loadAgentFolder, buildFileStores } from "../index.js";

// Returns a MockProvider that emits the given decision JSONs in sequence.
function scripted(responses: string[]): MockProvider {
  let i = 0;
  return new MockProvider([
    { match: () => true, text: () => responses[Math.min(i++, responses.length - 1)]! },
  ]);
}

const agent = {
  id: "memo", name: "Memo", naturalLanguageSpec: "", goals: [],
  providerConfig: { provider: "local", model: "x" },
  memoryModules: [
    { id: "wm", kind: "working", name: "W", description: "", backingStore: { type: "kv" }, records: [] },
    { id: "proc", kind: "procedural", name: "P", description: "", backingStore: { type: "code" }, records: [] },
    { id: "notes", kind: "semantic", name: "Notes", description: "", backingStore: { type: "inline" },
      retrievalConfig: { method: "recency", k: 5 }, records: [] },
  ],
  groundingInterfaces: [{ type: "dialogue" }],
  accessPolicy: [{ memoryModuleId: "notes", retrieval: { enabled: true, method: "recency" }, learning: { add: true, modify: false, delete: false } }],
  decisionProcedure: { style: "react", planning: {}, executionPolicy: "" },
  metadata: { version: 0 },
} as unknown as Agent;

describe("file-backed memory persistence", () => {
  it("persists a learned record across a turn and a restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "coala-persist-"));
    await saveAgentFolder(root, agent);

    // Turn 1: learn a fact, then respond.
    const p1 = scripted([
      JSON.stringify({ thought: "remember", action: { type: "learning", memoryModuleId: "notes", record: { fact: "user likes tea" } } }),
      JSON.stringify({ thought: "reply", action: { type: "respond", message: "Noted." } }),
    ]);
    const rt1 = new AgentRuntime(agent, p1, undefined, { stores: buildFileStores(root, agent) });
    const r1 = await rt1.runTurn("I like tea");
    expect(r1.reply).toBe("Noted.");

    // The learned record is on disk: a fresh load sees it as a seed record.
    const { agent: reloaded } = await loadAgentFolder(root);
    expect(reloaded.memoryModules.find((m) => m.id === "notes")!.records).toHaveLength(1);

    // Restart: brand-new runtime on the same folder retrieves the persisted memory.
    const rt2 = new AgentRuntime(reloaded, scripted([JSON.stringify({ thought: "reply", action: { type: "respond", message: "tea" } })]), undefined, { stores: buildFileStores(root, reloaded) });
    const retrieved = await rt2.stores.get("notes")!.retrieve({ text: "tea", method: "recency", k: 5 });
    expect(retrieved).toContainEqual({ fact: "user likes tea" });
  });
});
