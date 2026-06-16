import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Pointer } from "@coala/core";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.js";

export interface ModuleRef {
  name: string;
  kind: string;
}

/** One-line summary from a record's `data` (first few field values). */
function summarize(data: Record<string, unknown>): string {
  const vals = Object.values(data ?? {})
    .filter((v) => typeof v === "string" || typeof v === "number")
    .slice(0, 3)
    .map(String);
  return vals.join(" · ") || "(record)";
}

/** Read every `*.md` record file (skipping `_*.md`), parse frontmatter → pointers. */
async function readPointers(moduleDir: string): Promise<Pointer[]> {
  const entries = await readdir(moduleDir);
  const files = entries.filter((f) => f.endsWith(".md") && !f.startsWith("_"));
  const pointers: Pointer[] = [];
  for (const f of files) {
    const { data } = parseFrontmatter(await readFile(join(moduleDir, f), "utf8"));
    const id = String(data.id ?? f.replace(/\.md$/, ""));
    pointers.push({
      id,
      summary: summarize((data.data as Record<string, unknown>) ?? {}),
      meta: {
        importance: data.importance ?? 0,
        created: data.created ?? null,
        source: data.source ?? "seed",
      },
    });
  }
  return pointers;
}

/** Regenerate `<moduleDir>/_index.md` from record frontmatter; returns the pointers. */
export async function reindexModule(moduleDir: string, ref: ModuleRef): Promise<Pointer[]> {
  const pointers = await readPointers(moduleDir);
  const records = pointers.map((p) => ({ id: p.id, summary: p.summary, ...p.meta }));
  const bullets = pointers
    .map((p) => `- [${p.id}](${p.id}.md) — ${p.summary}`)
    .join("\n");
  const body = `# ${ref.name} — index\n\n${bullets}\n`;
  await writeFile(
    join(moduleDir, "_index.md"),
    stringifyFrontmatter({ module: ref.name, kind: ref.kind, records }, body),
  );
  return pointers;
}
