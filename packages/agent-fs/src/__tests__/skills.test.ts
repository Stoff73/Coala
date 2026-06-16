import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSkill } from "../skills.js";

describe("resolveSkill", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "coala-skill-"));
    await mkdir(join(root, "scripts"), { recursive: true });
    await writeFile(join(root, "scripts", "lookup.py"), "print('hi')");
    await writeFile(join(root, "note.md"), "referenced content");
  });

  it("returns template content directly", async () => {
    const r = await resolveSkill(root, { id: "g", kind: "template", content: "Hello {{name}}" });
    expect(r).toEqual({ id: "g", kind: "template", executed: false, content: "Hello {{name}}" });
  });

  it("reads a reference target", async () => {
    const r = await resolveSkill(root, { id: "n", kind: "reference", path: "note.md" });
    expect(r.content).toBe("referenced content");
  });

  it("resolves a script but does NOT execute it", async () => {
    const r = await resolveSkill(root, { id: "l", kind: "script", run: { interpreter: "python", script: "scripts/lookup.py" } });
    expect(r.executed).toBe(false);
    expect(r.placeholder).toContain("would run python");
  });

  it("rejects a script path that escapes the root", async () => {
    await expect(
      resolveSkill(root, { id: "x", kind: "script", run: { interpreter: "python", script: "../evil.py" } }),
    ).rejects.toThrow(/escapes/);
  });

  it("reads a reference given an absolute path inside root", async () => {
    const r = await resolveSkill(root, { id: "n", kind: "reference", path: join(root, "note.md") });
    expect(r.content).toBe("referenced content");
  });
  it("throws a clear error when a reference has no path", async () => {
    await expect(resolveSkill(root, { id: "n", kind: "reference" })).rejects.toThrow(/missing required field "path"/);
  });
  it("throws a clear error when a script has no run.script", async () => {
    await expect(resolveSkill(root, { id: "s", kind: "script", run: { interpreter: "python", script: "" } })).rejects.toThrow(/missing required field "run.script"/);
  });
});
