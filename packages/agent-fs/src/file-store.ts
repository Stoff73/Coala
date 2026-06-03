import { readFile, writeFile, rename, access } from "node:fs/promises";
import { join } from "node:path";
import type { Store, Pointer, Record_, RecordMeta, RetrievalQuery } from "@coala/core";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.js";
import { reindexModule, type ModuleRef } from "./reindex.js";
import { slugify } from "./paths.js";

function tokens(s: string): string[] {
  return s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/** A file-backed Store: lean record-level index, lazy bodies, immediate write-back. */
export class FileStore implements Store {
  constructor(
    private readonly moduleDir: string,
    private readonly ref: ModuleRef,
  ) {}

  private async indexExists(): Promise<boolean> {
    try { await access(join(this.moduleDir, "_index.md")); return true; }
    catch { return false; }
  }

  async listPointers(): Promise<Pointer[]> {
    if (!(await this.indexExists())) return reindexModule(this.moduleDir, this.ref);
    const { data } = parseFrontmatter(await readFile(join(this.moduleDir, "_index.md"), "utf8"));
    const records = (data.records as Array<Record<string, unknown>>) ?? [];
    return records.map((r) => ({
      id: String(r.id),
      summary: String(r.summary ?? ""),
      meta: { importance: r.importance ?? 0, created: r.created ?? null, source: r.source ?? "seed" },
    }));
  }

  async openBody(id: string): Promise<Record_ | undefined> {
    try {
      const { data } = parseFrontmatter(await readFile(join(this.moduleDir, `${id}.md`), "utf8"));
      return ((data.data as Record_) ?? {}) as Record_;
    } catch {
      return undefined;
    }
  }

  async retrieve(q: RetrievalQuery): Promise<Record_[]> {
    const pointers = await this.listPointers();
    const ranked = this.rank(pointers, q);
    const out: Record_[] = [];
    for (const p of ranked.slice(0, q.k)) {
      const body = await this.openBody(p.id);
      if (body) out.push(body);
    }
    return out;
  }

  private rank(pointers: Pointer[], q: RetrievalQuery): Pointer[] {
    switch (q.method) {
      case "recency":
        return [...pointers].sort((a, b) =>
          String(b.meta.created ?? "").localeCompare(String(a.meta.created ?? "")));
      case "importance":
        return [...pointers].sort((a, b) => Number(b.meta.importance ?? 0) - Number(a.meta.importance ?? 0));
      case "rule":
        return pointers;
      case "relevance":
      case "embedding":
      default: {
        const qset = new Set(tokens(q.text));
        return [...pointers]
          .map((p) => ({ p, s: tokens(p.summary).filter((t) => qset.has(t)).length }))
          .filter((x) => x.s > 0)
          .sort((a, b) => b.s - a.s)
          .map((x) => x.p);
      }
    }
  }

  async add(record: Record_, meta?: RecordMeta): Promise<Pointer> {
    // `RecordMeta` (the Store interface type) doesn't carry an id; callers may
    // pass one for a deterministic filename, so read it off via a cast without
    // widening the public signature past the Store contract.
    const explicitId = (meta as (RecordMeta & { id?: string }) | undefined)?.id;
    const id = slugify(explicitId ?? `rec-${(await this.listPointers()).length + 1}`);
    const file = join(this.moduleDir, `${id}.md`);
    const frontmatter: Record<string, unknown> = {
      id,
      source: meta?.source ?? "runtime",
      created: new Date().toISOString(),
      importance: meta?.importance ?? 0,
      data: record,
    };
    // Atomic write: temp file + rename.
    const tmp = `${file}.tmp`;
    await writeFile(tmp, stringifyFrontmatter(frontmatter, meta?.body ?? ""));
    await rename(tmp, file);
    const pointers = await reindexModule(this.moduleDir, this.ref);
    return pointers.find((p) => p.id === id) ?? { id, summary: "", meta: {} };
  }
}
