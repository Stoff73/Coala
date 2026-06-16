import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PRESETS } from "@coala/core";
import type { Agent } from "@coala/core";
import { saveAgentFolder } from "../folder.js";
import { buildFileStores } from "../build-stores.js";

describe("buildFileStores", () => {
  it("creates one FileStore per long-term module", async () => {
    const retail = PRESETS.find((p) => /retail/i.test(p.name))!;
    const root = await mkdtemp(join(tmpdir(), "coala-build-"));
    await saveAgentFolder(root, retail);
    const stores = buildFileStores(root, retail);
    const ltm = retail.memoryModules.filter((m) => m.kind !== "working");
    expect([...stores.keys()].sort()).toEqual(ltm.map((m) => m.id).sort());
    const first = stores.get(ltm[0]!.id)!;
    expect(Array.isArray(await first.listPointers())).toBe(true);
  });

  it("retrieves a SEEDED record whose id needs slugifying (file/frontmatter/index/openBody agree)", async () => {
    const agent = {
      id: "seed-test", name: "Seed Test", naturalLanguageSpec: "", goals: [],
      providerConfig: { provider: "local", model: "x" },
      memoryModules: [
        { id: "wm", kind: "working", name: "W", description: "", backingStore: { type: "kv" }, records: [] },
        { id: "facts", kind: "semantic", name: "Facts", description: "", backingStore: { type: "inline" },
          retrievalConfig: { method: "recency", k: 5 },
          records: [{ id: "Widget X / v2", data: { fact: "widget exists" }, source: "seed" }] },
      ],
      groundingInterfaces: [{ type: "dialogue", id: "g1", name: "Dialogue" }],
      accessPolicy: [{ memoryModuleId: "facts", retrieval: { enabled: true, method: "recency" }, learning: { add: false, modify: false, delete: false } }],
      decisionProcedure: { style: "react", planning: {}, executionPolicy: "" },
      metadata: { version: 0 },
    } as unknown as Agent;
    const root = await mkdtemp(join(tmpdir(), "coala-seed-"));
    await saveAgentFolder(root, agent);
    const store = buildFileStores(root, agent).get("facts")!;
    const ptrs = await store.listPointers();
    expect(ptrs).toHaveLength(1);
    expect(await store.openBody(ptrs[0]!.id)).toEqual({ fact: "widget exists" }); // openBody must resolve the pointer id
    expect(await store.retrieve({ text: "", method: "recency", k: 5 })).toContainEqual({ fact: "widget exists" });
  });
});
