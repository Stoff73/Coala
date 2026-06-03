import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, writeFile, mkdir, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStore } from "../file-store.js";

async function moduleDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "coala-fs-"));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "a.md"), "---\nid: a\nimportance: 0.2\ncreated: 2026-01-01T00:00:00Z\ndata: { fact: cats purr }\n---\n");
  await writeFile(join(dir, "b.md"), "---\nid: b\nimportance: 0.9\ncreated: 2026-02-01T00:00:00Z\ndata: { fact: dogs bark loudly }\n---\n");
  return dir;
}

describe("FileStore", () => {
  let dir: string;
  beforeEach(async () => { dir = await moduleDir(); });

  it("lists pointers without loading bodies", async () => {
    const s = new FileStore(dir, { name: "facts", kind: "semantic" });
    const ptrs = await s.listPointers();
    expect(ptrs.map((p) => p.id).sort()).toEqual(["a", "b"]);
  });

  it("opens one body lazily", async () => {
    const s = new FileStore(dir, { name: "facts", kind: "semantic" });
    expect(await s.openBody("a")).toEqual({ fact: "cats purr" });
  });

  it("ranks by importance", async () => {
    const s = new FileStore(dir, { name: "facts", kind: "semantic" });
    const recs = await s.retrieve({ text: "", method: "importance", k: 1 });
    expect(recs).toEqual([{ fact: "dogs bark loudly" }]);
  });

  it("ranks by relevance (keyword overlap)", async () => {
    const s = new FileStore(dir, { name: "facts", kind: "semantic" });
    const recs = await s.retrieve({ text: "loud dogs", method: "relevance", k: 1 });
    expect(recs).toEqual([{ fact: "dogs bark loudly" }]);
  });

  it("add() writes a record file AND updates _index.md", async () => {
    const s = new FileStore(dir, { name: "facts", kind: "semantic" });
    const ptr = await s.add({ fact: "birds chirp" }, { id: "c", importance: 0.5 } as any);
    expect(ptr.id).toBe("c");
    await access(join(dir, "c.md")); // throws if missing
    const idx = await readFile(join(dir, "_index.md"), "utf8");
    expect(idx).toContain("c");
    expect((await s.listPointers()).map((p) => p.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("add() generates distinct ids for concurrent no-id writes", async () => {
    const s = new FileStore(dir, { name: "facts", kind: "semantic" });
    const [p1, p2] = await Promise.all([s.add({ fact: "x" }), s.add({ fact: "y" })]);
    expect(p1.id).not.toBe(p2.id);
    expect((await s.listPointers()).length).toBe(4); // a, b, + 2 new
  });

  it("add() rejects an id that slugifies to empty", async () => {
    const s = new FileStore(dir, { name: "facts", kind: "semantic" });
    await expect(s.add({ fact: "x" }, { id: "///" } as any)).rejects.toThrow(/empty/);
  });

  it("relevance with a blank query returns records (falls back to all)", async () => {
    const s = new FileStore(dir, { name: "facts", kind: "semantic" });
    const recs = await s.retrieve({ text: "", method: "relevance", k: 5 });
    expect(recs.length).toBe(2);
  });
});
