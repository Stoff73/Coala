import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PRESETS } from "@coala/core";
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
});
