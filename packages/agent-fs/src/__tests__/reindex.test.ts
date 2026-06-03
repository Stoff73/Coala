import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, writeFile, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reindexModule } from "../reindex.js";
import { parseFrontmatter } from "../frontmatter.js";

async function tmp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "coala-reindex-"));
  await mkdir(dir, { recursive: true });
  return dir;
}

describe("reindexModule", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await tmp();
    await writeFile(join(dir, "widget-x.md"), "---\nid: widget-x\nimportance: 0.8\ndata: { name: Widget X, price: 19.99 }\n---\nNotes.\n");
    await writeFile(join(dir, "gizmo.md"), "---\nid: gizmo\nimportance: 0.5\ndata: { name: Gizmo, price: 49 }\n---\n");
    await writeFile(join(dir, "_schema.yaml"), "title: Product\n"); // underscore files ignored
  });

  it("writes _index.md with a frontmatter records array", async () => {
    const pointers = await reindexModule(dir, { name: "products", kind: "semantic" });
    expect(pointers.map((p) => p.id).sort()).toEqual(["gizmo", "widget-x"]);
    const idx = parseFrontmatter(await readFile(join(dir, "_index.md"), "utf8"));
    const recs = idx.data.records as Array<{ id: string }>;
    expect(recs.map((r) => r.id).sort()).toEqual(["gizmo", "widget-x"]);
    expect(idx.body).toContain("widget-x");
  });
});
