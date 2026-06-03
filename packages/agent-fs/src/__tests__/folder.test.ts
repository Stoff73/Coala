import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PRESETS, parseAgent } from "@coala/core";
import { saveAgentFolder, loadAgentFolder } from "../folder.js";

describe("agent folder round-trip", () => {
  for (const preset of PRESETS) {
    it(`round-trips the "${preset.name}" preset`, async () => {
      const root = await mkdtemp(join(tmpdir(), "coala-folder-"));
      await saveAgentFolder(root, preset);
      const { agent } = await loadAgentFolder(root);
      const reparsed = parseAgent(agent); // structurally valid

      expect(agent.id).toBe(preset.id);
      expect(agent.name).toBe(preset.name);
      expect(agent.memoryModules.map((m) => m.id).sort()).toEqual(
        preset.memoryModules.map((m) => m.id).sort(),
      );
      expect(agent.accessPolicy.map((a) => a.memoryModuleId).sort()).toEqual(
        preset.accessPolicy.map((a) => a.memoryModuleId).sort(),
      );
      expect(reparsed.decisionProcedure.style).toBe(preset.decisionProcedure.style);
    });
  }

  it("writes a master memory/index.md catalog", async () => {
    const root = await mkdtemp(join(tmpdir(), "coala-master-"));
    await saveAgentFolder(root, PRESETS[0]!);
    expect(await readFile(join(root, "memory", "index.md"), "utf8")).toContain("Memory Index");
  });

  it("ignores a stray non-directory file (e.g. .DS_Store) in a kind dir", async () => {
    const root = await mkdtemp(join(tmpdir(), "coala-stray-"));
    await saveAgentFolder(root, PRESETS.find((p) => p.memoryModules.some((m) => m.kind === "semantic"))!);
    // find a kind dir that exists and drop a stray file into it
    const semantic = join(root, "memory", "semantic");
    await writeFile(join(semantic, ".DS_Store"), "junk");
    const { agent } = await loadAgentFolder(root); // must not throw
    expect(agent.id).toBeTruthy();
  });

  it("rejects two same-kind modules whose ids collide to one folder", async () => {
    const base = PRESETS[0]!;
    const clash = {
      ...base,
      memoryModules: [
        ...base.memoryModules,
        { id: "My Notes", kind: "semantic", name: "A", description: "", backingStore: { type: "inline" }, records: [] },
        { id: "my-notes!", kind: "semantic", name: "B", description: "", backingStore: { type: "inline" }, records: [] },
      ],
    } as any;
    const root = await mkdtemp(join(tmpdir(), "coala-clash-"));
    await expect(saveAgentFolder(root, clash)).rejects.toThrow(/same folder/);
  });
});
