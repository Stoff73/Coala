# File-Based Memory Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a CoALA agent a self-contained markdown/YAML folder whose learning persists to disk, so memory survives across turns and restarts ("gets better over time").

**Architecture:** Promote `Store` to an interface in `@coala/core`; add a `@coala/agent-fs` package that (de)serializes an agent folder and implements a file-backed `FileStore` with a lean record-level index, lazy body loading, and immediate write-back; refactor `AgentRuntime` to accept injected stores, add a `memory.open` tool, and add a post-turn episodic-capture step.

**Tech Stack:** TypeScript (ESM, NodeNext, `verbatimModuleSyntax`), zod, the `yaml` package (v2, already used by `@coala/export`), vitest, Node `fs/promises`.

**Scope:** This plan is the engine only. Web local-mode adoption and the SQLite→folder migration are a **sequel plan** (`2026-06-03-web-local-mode-adoption.md`, to be written after this plan is green). This plan is independently testable via vitest + `MockProvider`.

**Conventions (must follow):**
- ESM: relative imports use `.js` extensions; type-only imports use `import type`.
- Cross-package imports resolve through built `dist/`. Build order: `core → providers → {runtime, agent-fs} → …`. After changing `@coala/core`, run `npm run -w @coala/core build` before building/testing dependents.
- Tests live in `src/__tests__/*.test.ts` and run with `vitest run` (no separate vitest config; defaults).
- Commit after every passing task.

---

## File Structure

**`@coala/core` (modified)**
- Create `packages/core/src/runtime/store.ts` — the `Store` interface + `Pointer`, `RecordMeta`, `Record_`, `RetrievalQuery` types. One responsibility: the storage contract shared by all stores.
- Modify `packages/core/src/index.ts` — export the new module.

**`@coala/agent-fs` (new package)**
- `packages/agent-fs/package.json`, `tsconfig.json`
- `src/index.ts` — public exports.
- `src/frontmatter.ts` — parse/serialize "YAML frontmatter + markdown body" files. One responsibility: file ↔ `{ data, body }`.
- `src/paths.ts` — slugify ids to safe filenames; assert a path is confined inside a root.
- `src/folder.ts` — `loadAgentFolder` / `saveAgentFolder`: agent folder ⇄ `Agent`. One responsibility: blueprint (de)serialization + path⇄id mapping.
- `src/reindex.ts` — regenerate a module's `_index.md` from its record frontmatter.
- `src/file-store.ts` — `FileStore implements Store` + `buildFileStores(root, agent)`.
- `src/skills.ts` — `resolveSkill` (template / reference / script; execution deferred).
- `src/__tests__/*.test.ts` — unit + integration tests, with a `fixtures/` tree.

**`@coala/runtime` (modified)**
- Modify `packages/runtime/src/memory.ts` — `InMemoryStore implements Store` (async), re-export shared types from core.
- Modify `packages/runtime/src/executor.ts` — inject stores; `await` store calls; add `memory.open` tool; add `captureEpisodes` post-turn reflection.
- Modify `packages/runtime/src/embedding.ts` — add `rankPointers` so embedding retrieval ranks pointer summaries (no full-body load).
- Modify `packages/runtime/src/index.ts` — re-export shared store types from core.
- Modify `packages/runtime/src/__tests__/runtime.test.ts` — update assertions to the async `Store` interface.

---

## Task 1: Store interface in `@coala/core`

**Files:**
- Create: `packages/core/src/runtime/store.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/__tests__/store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/__tests__/store.test.ts
import { describe, it, expect } from "vitest";
import type { Store, Pointer, Record_, RetrievalQuery, RecordMeta } from "../runtime/store.js";

// A minimal in-test implementation proves the interface is usable/coherent.
class ArrayStore implements Store {
  private recs: Record_[] = [];
  async listPointers(): Promise<Pointer[]> {
    return this.recs.map((r, i) => ({ id: String(i), summary: JSON.stringify(r), meta: r }));
  }
  async openBody(id: string): Promise<Record_ | undefined> {
    return this.recs[Number(id)];
  }
  async retrieve(_q: RetrievalQuery): Promise<Record_[]> {
    return this.recs;
  }
  async add(record: Record_, _meta?: RecordMeta): Promise<Pointer> {
    this.recs.push(record);
    return { id: String(this.recs.length - 1), summary: JSON.stringify(record), meta: record };
  }
}

describe("Store contract", () => {
  it("supports add → listPointers → openBody → retrieve", async () => {
    const s = new ArrayStore();
    const ptr = await s.add({ a: 1 });
    expect(ptr.id).toBe("0");
    expect(await s.listPointers()).toHaveLength(1);
    expect(await s.openBody("0")).toEqual({ a: 1 });
    expect(await s.retrieve({ text: "x", method: "recency", k: 5 })).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run -w @coala/core test -- src/__tests__/store.test.ts`
Expected: FAIL — `Cannot find module '../runtime/store.js'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/core/src/runtime/store.ts
import type { RetrievalMethod } from "../schema/common.js";
import type { RecordSource } from "../schema/memory.js";

/** A loosely-typed memory record's `data` payload. */
export type Record_ = Record<string, unknown>;

/** A retrieval request against a single store (paper §4.3). */
export interface RetrievalQuery {
  text: string;
  method: RetrievalMethod;
  k: number;
}

/** A lean handle to one record — enough to rank without loading its body. */
export interface Pointer {
  id: string;
  summary: string;
  /** Rankable metadata: importance, created, source, … */
  meta: Record<string, unknown>;
}

/** Metadata supplied when writing a record. */
export interface RecordMeta {
  source?: RecordSource;
  importance?: number;
  /** Free-form markdown notes stored in the record body. */
  body?: string;
}

/**
 * The storage contract shared by every memory backend. `listPointers` is cheap
 * (no bodies); `openBody` is lazy (one record); `retrieve` ranks then opens
 * top-k; `add` persists and returns the new pointer.
 */
export interface Store {
  listPointers(): Promise<Pointer[]>;
  openBody(id: string): Promise<Record_ | undefined>;
  retrieve(q: RetrievalQuery): Promise<Record_[]>;
  add(record: Record_, meta?: RecordMeta): Promise<Pointer>;
}
```

```ts
// packages/core/src/index.ts — add after the existing schema exports block
export * from "./runtime/store.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run -w @coala/core build && npm run -w @coala/core test -- src/__tests__/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/runtime/store.ts packages/core/src/index.ts packages/core/src/__tests__/store.test.ts
git commit -m "feat(core): add Store interface + Pointer/RecordMeta/Record_/RetrievalQuery types"
```

---

## Task 2: Scaffold `@coala/agent-fs`

**Files:**
- Create: `packages/agent-fs/package.json`
- Create: `packages/agent-fs/tsconfig.json`
- Create: `packages/agent-fs/src/index.ts`
- Test: `packages/agent-fs/src/__tests__/smoke.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/agent-fs/src/__tests__/smoke.test.ts
import { describe, it, expect } from "vitest";
import { AGENT_FS_VERSION } from "../index.js";

describe("@coala/agent-fs", () => {
  it("exposes a version constant", () => {
    expect(AGENT_FS_VERSION).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run -w @coala/agent-fs test -- src/__tests__/smoke.test.ts`
Expected: FAIL — package/script not found (the workspace doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

```json
// packages/agent-fs/package.json
{
  "name": "@coala/agent-fs",
  "version": "0.0.0",
  "description": "Portable agent folder (de)serializer + file-backed memory store",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@coala/core": "*",
    "yaml": "^2.5.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
  }
}
```

```json
// packages/agent-fs/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["dist", "node_modules", "src/**/*.test.ts"]
}
```

```ts
// packages/agent-fs/src/index.ts
export const AGENT_FS_VERSION = 1;
```

- [ ] **Step 4: Link the workspace, then run the test**

Run: `npm install && npm run -w @coala/agent-fs test -- src/__tests__/smoke.test.ts`
Expected: PASS. (`npm install` at the root links the new workspace.)

- [ ] **Step 5: Commit**

```bash
git add packages/agent-fs/package.json packages/agent-fs/tsconfig.json packages/agent-fs/src/index.ts packages/agent-fs/src/__tests__/smoke.test.ts package-lock.json
git commit -m "feat(agent-fs): scaffold package"
```

---

## Task 3: Frontmatter read/write

**Files:**
- Create: `packages/agent-fs/src/frontmatter.ts`
- Test: `packages/agent-fs/src/__tests__/frontmatter.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/agent-fs/src/__tests__/frontmatter.test.ts
import { describe, it, expect } from "vitest";
import { parseFrontmatter, stringifyFrontmatter } from "../frontmatter.js";

describe("frontmatter", () => {
  it("parses YAML frontmatter + markdown body", () => {
    const src = "---\nid: widget-x\nimportance: 0.8\n---\nWidget X notes.\n";
    const { data, body } = parseFrontmatter(src);
    expect(data).toEqual({ id: "widget-x", importance: 0.8 });
    expect(body).toBe("Widget X notes.\n");
  });

  it("treats a file with no frontmatter as all body", () => {
    const { data, body } = parseFrontmatter("just text");
    expect(data).toEqual({});
    expect(body).toBe("just text");
  });

  it("round-trips", () => {
    const out = stringifyFrontmatter({ id: "a", n: 1 }, "Body here.");
    const { data, body } = parseFrontmatter(out);
    expect(data).toEqual({ id: "a", n: 1 });
    expect(body).toBe("Body here.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run -w @coala/agent-fs test -- src/__tests__/frontmatter.test.ts`
Expected: FAIL — `Cannot find module '../frontmatter.js'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/agent-fs/src/frontmatter.ts
import YAML from "yaml";

export interface Parsed {
  data: Record<string, unknown>;
  body: string;
}

const FM = /^---\n([\s\S]*?)\n---\n?/;

/** Split a "YAML frontmatter + markdown body" string. No frontmatter → all body. */
export function parseFrontmatter(src: string): Parsed {
  const m = FM.exec(src);
  if (!m) return { data: {}, body: src };
  const data = (YAML.parse(m[1]) ?? {}) as Record<string, unknown>;
  return { data, body: src.slice(m[0].length) };
}

/** Serialize frontmatter + body. A trailing newline is ensured after the fence. */
export function stringifyFrontmatter(data: Record<string, unknown>, body = ""): string {
  const yaml = YAML.stringify(data).trimEnd();
  return `---\n${yaml}\n---\n${body}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run -w @coala/agent-fs test -- src/__tests__/frontmatter.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-fs/src/frontmatter.ts packages/agent-fs/src/__tests__/frontmatter.test.ts
git commit -m "feat(agent-fs): YAML-frontmatter file parse/serialize"
```

---

## Task 4: Path safety helpers

**Files:**
- Create: `packages/agent-fs/src/paths.ts`
- Test: `packages/agent-fs/src/__tests__/paths.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/agent-fs/src/__tests__/paths.test.ts
import { describe, it, expect } from "vitest";
import { slugify, assertInside } from "../paths.js";

describe("paths", () => {
  it("slugifies ids to safe filenames", () => {
    expect(slugify("Widget X / v2")).toBe("widget-x-v2");
    expect(slugify("2026-06-03T08:30")).toBe("2026-06-03t08-30");
  });

  it("accepts a path inside the root", () => {
    expect(() => assertInside("/agents/a", "/agents/a/scripts/x.py")).not.toThrow();
  });

  it("rejects a path that escapes the root", () => {
    expect(() => assertInside("/agents/a", "/agents/a/../b/x.py")).toThrow(/escapes/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run -w @coala/agent-fs test -- src/__tests__/paths.test.ts`
Expected: FAIL — `Cannot find module '../paths.js'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/agent-fs/src/paths.ts
import { resolve, relative, isAbsolute } from "node:path";

/** Lowercase, hyphenate, strip unsafe characters → a portable filename stem. */
export function slugify(id: string): string {
  return id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Throw if `target` resolves outside `root` (path-traversal guard). */
export function assertInside(root: string, target: string): void {
  const r = resolve(root);
  const t = resolve(r, target);
  const rel = relative(r, t);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Path "${target}" escapes the agent root "${root}".`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run -w @coala/agent-fs test -- src/__tests__/paths.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-fs/src/paths.ts packages/agent-fs/src/__tests__/paths.test.ts
git commit -m "feat(agent-fs): slugify + path-traversal guard"
```

---

## Task 5: `reindex` — regenerate a module index from record frontmatter

**Files:**
- Create: `packages/agent-fs/src/reindex.ts`
- Test: `packages/agent-fs/src/__tests__/reindex.test.ts`

The generated `_index.md` carries a structured frontmatter `records:` array (what `FileStore` ranks over) plus human-readable bullets in the body.

- [ ] **Step 1: Write the failing test**

```ts
// packages/agent-fs/src/__tests__/reindex.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run -w @coala/agent-fs test -- src/__tests__/reindex.test.ts`
Expected: FAIL — `Cannot find module '../reindex.js'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/agent-fs/src/reindex.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run -w @coala/agent-fs test -- src/__tests__/reindex.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-fs/src/reindex.ts packages/agent-fs/src/__tests__/reindex.test.ts
git commit -m "feat(agent-fs): reindexModule regenerates _index.md from record frontmatter"
```

---

## Task 6: `FileStore` — listPointers, openBody, retrieve, add

**Files:**
- Create: `packages/agent-fs/src/file-store.ts`
- Test: `packages/agent-fs/src/__tests__/file-store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/agent-fs/src/__tests__/file-store.test.ts
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run -w @coala/agent-fs test -- src/__tests__/file-store.test.ts`
Expected: FAIL — `Cannot find module '../file-store.js'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/agent-fs/src/file-store.ts
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

  async add(record: Record_, meta?: RecordMeta & { id?: string }): Promise<Pointer> {
    const id = slugify(meta?.id ?? `rec-${(await this.listPointers()).length + 1}`);
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
```

> Note: `Date` is available in normal runtime code (it is only restricted inside Workflow scripts). Tests pass an explicit `id` via `meta` so filenames are deterministic; `created` is not asserted.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run -w @coala/agent-fs test -- src/__tests__/file-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-fs/src/file-store.ts packages/agent-fs/src/__tests__/file-store.test.ts
git commit -m "feat(agent-fs): FileStore — lean index, lazy bodies, atomic write-back"
```

---

## Task 7: `saveAgentFolder` / `loadAgentFolder` + preset round-trip

**Files:**
- Create: `packages/agent-fs/src/folder.ts`
- Modify: `packages/agent-fs/src/index.ts`
- Test: `packages/agent-fs/src/__tests__/folder.test.ts`

The folder maps `agent.md` (frontmatter blueprint minus memory + prose spec) plus the `memory/<kind>/<module-slug>/` tree (each module's `_schema.yaml`, optional `_rubric.yaml`, and seed records) back to the `Agent` type. `accessPolicy` references modules by `<kind>/<slug>` path; `folder.ts` owns the path⇄id mapping.

- [ ] **Step 1: Write the failing test**

```ts
// packages/agent-fs/src/__tests__/folder.test.ts
import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { presets } from "@coala/core";
import { parseAgent } from "@coala/core";
import { saveAgentFolder, loadAgentFolder } from "../folder.js";

describe("agent folder round-trip", () => {
  for (const preset of presets) {
    it(`round-trips the "${preset.name}" preset`, async () => {
      const root = await mkdtemp(join(tmpdir(), "coala-folder-"));
      await saveAgentFolder(root, preset);
      const { agent } = await loadAgentFolder(root);
      const reparsed = parseAgent(agent); // structurally valid

      // Identity of the parts the folder owns:
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
});
```

> First confirm the preset export name: `grep -n "export" packages/core/src/presets/index.ts`. If the array is exported under a different name (e.g. `PRESETS`), use that name in the import.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run -w @coala/agent-fs test -- src/__tests__/folder.test.ts`
Expected: FAIL — `Cannot find module '../folder.js'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/agent-fs/src/folder.ts
import { mkdir, writeFile, readFile, readdir, access } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { parseAgent, type Agent, type MemoryModule } from "@coala/core";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.js";
import { reindexModule } from "./reindex.js";
import { slugify } from "./paths.js";

const MODULE_KINDS = ["semantic", "episodic", "procedural"] as const;
type LtKind = (typeof MODULE_KINDS)[number];

/** Path used in agent.md to reference a module: `<kind>/<slug>`. */
function modulePath(m: MemoryModule): string {
  return `${m.kind}/${slugify(m.id)}`;
}

export async function saveAgentFolder(root: string, agent: Agent): Promise<void> {
  await mkdir(join(root, "memory"), { recursive: true });

  // Map module ids → paths for accessPolicy.
  const idToPath = new Map(agent.memoryModules.map((m) => [m.id, modulePath(m)] as const));

  // agent.md: everything except the memory tree, plus access policy by path.
  const frontmatter = {
    coalaVersion: 1,
    id: agent.id,
    name: agent.name,
    goals: agent.goals,
    provider: agent.providerConfig,
    decisionProcedure: agent.decisionProcedure,
    grounding: agent.groundingInterfaces,
    metadata: agent.metadata,
    accessPolicy: agent.accessPolicy.map((a) => ({
      module: idToPath.get(a.memoryModuleId) ?? a.memoryModuleId,
      retrieval: a.retrieval,
      learning: a.learning,
    })),
  };
  await writeFile(join(root, "agent.md"), stringifyFrontmatter(frontmatter, `# ${agent.name}\n\n${agent.naturalLanguageSpec}\n`));

  // memory/<kind>/<slug>/ per long-term module.
  for (const m of agent.memoryModules) {
    if (!MODULE_KINDS.includes(m.kind as LtKind)) continue; // working memory has no folder
    const dir = join(root, "memory", m.kind, slugify(m.id));
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "_meta.yaml"),
      YAML.stringify({ id: m.id, name: m.name, description: m.description, rationale: m.rationale, retrievalConfig: m.retrievalConfig, backingStore: m.backingStore }),
    );
    if (m.schema) await writeFile(join(dir, "_schema.yaml"), YAML.stringify(m.schema));
    if (m.rubric) await writeFile(join(dir, "_rubric.yaml"), YAML.stringify(m.rubric));
    if (m.procedural) await writeFile(join(dir, "_procedural.yaml"), YAML.stringify(m.procedural));
    for (const rec of m.records) {
      await writeFile(
        join(dir, `${slugify(rec.id)}.md`),
        stringifyFrontmatter({ id: rec.id, source: rec.source, data: rec.data }, ""),
      );
    }
    await reindexModule(dir, { name: m.name, kind: m.kind });
  }
}

async function exists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

async function loadModule(dir: string): Promise<MemoryModule> {
  const meta = YAML.parse(await readFile(join(dir, "_meta.yaml"), "utf8")) as Record<string, unknown>;
  const mod: Record<string, unknown> = { ...meta, records: [] };
  if (await exists(join(dir, "_schema.yaml"))) mod.schema = YAML.parse(await readFile(join(dir, "_schema.yaml"), "utf8"));
  if (await exists(join(dir, "_rubric.yaml"))) mod.rubric = YAML.parse(await readFile(join(dir, "_rubric.yaml"), "utf8"));
  if (await exists(join(dir, "_procedural.yaml"))) mod.procedural = YAML.parse(await readFile(join(dir, "_procedural.yaml"), "utf8"));
  const files = (await readdir(dir)).filter((f) => f.endsWith(".md") && !f.startsWith("_"));
  const records = [];
  for (const f of files) {
    const { data } = parseFrontmatter(await readFile(join(dir, f), "utf8"));
    records.push({ id: String(data.id ?? f.replace(/\.md$/, "")), data: (data.data as Record<string, unknown>) ?? {}, source: (data.source as string) ?? "seed" });
  }
  mod.records = records;
  return mod as unknown as MemoryModule;
}

export async function loadAgentFolder(root: string): Promise<{ agent: Agent; root: string }> {
  const { data, body } = parseFrontmatter(await readFile(join(root, "agent.md"), "utf8"));

  const memoryModules: MemoryModule[] = [];
  for (const kind of MODULE_KINDS) {
    const kindDir = join(root, "memory", kind);
    if (!(await exists(kindDir))) continue;
    for (const slug of await readdir(kindDir)) {
      memoryModules.push(await loadModule(join(kindDir, slug)));
    }
  }

  // Map module path → id for accessPolicy.
  const pathToId = new Map(memoryModules.map((m) => [`${m.kind}/${slugify(m.id)}`, m.id] as const));
  const accessPolicy = ((data.accessPolicy as Array<Record<string, unknown>>) ?? []).map((a) => ({
    memoryModuleId: pathToId.get(String(a.module)) ?? String(a.module),
    retrieval: a.retrieval,
    learning: a.learning,
  }));

  const agent = parseAgent({
    id: data.id,
    name: data.name,
    naturalLanguageSpec: body.replace(/^#.*\n+/, "").trim(),
    goals: data.goals ?? [],
    providerConfig: data.provider,
    memoryModules,
    groundingInterfaces: data.grounding ?? [],
    accessPolicy,
    decisionProcedure: data.decisionProcedure,
    metadata: data.metadata,
  });
  return { agent, root };
}
```

```ts
// packages/agent-fs/src/index.ts — append
export { saveAgentFolder, loadAgentFolder } from "./folder.js";
export { FileStore } from "./file-store.js";
export { reindexModule } from "./reindex.js";
export { resolveSkill } from "./skills.js";
export { buildFileStores } from "./build-stores.js";
```

> The last two re-exports (`resolveSkill`, `buildFileStores`) are added in Tasks 8–9; if running tasks strictly in order, add those two export lines when you create those files (Step 5 of each) to keep the build green. For now include only `saveAgentFolder`, `loadAgentFolder`, `FileStore`, `reindexModule`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run -w @coala/core build && npm run -w @coala/agent-fs test -- src/__tests__/folder.test.ts`
Expected: PASS for all six presets. If a preset fails, the folder format cannot represent it — fix `folder.ts` (do not weaken the preset).

- [ ] **Step 5: Commit**

```bash
git add packages/agent-fs/src/folder.ts packages/agent-fs/src/index.ts packages/agent-fs/src/__tests__/folder.test.ts
git commit -m "feat(agent-fs): saveAgentFolder/loadAgentFolder with six-preset round-trip"
```

---

## Task 8: `resolveSkill` (template / reference / script; execution deferred)

**Files:**
- Create: `packages/agent-fs/src/skills.ts`
- Modify: `packages/agent-fs/src/index.ts` (add `export { resolveSkill } from "./skills.js";`)
- Test: `packages/agent-fs/src/__tests__/skills.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/agent-fs/src/__tests__/skills.test.ts
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run -w @coala/agent-fs test -- src/__tests__/skills.test.ts`
Expected: FAIL — `Cannot find module '../skills.js'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/agent-fs/src/skills.ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { assertInside } from "./paths.js";

export interface SkillDef {
  id: string;
  kind: "template" | "reference" | "script";
  content?: string;                                   // template
  path?: string;                                      // reference
  run?: { interpreter: string; script: string };      // script
}

export interface ResolvedSkill {
  id: string;
  kind: SkillDef["kind"];
  executed: false;            // execution is deferred this round
  content?: string;
  placeholder?: string;
}

/** Resolve a skill's pointer. Scripts are surfaced, never executed (this round). */
export async function resolveSkill(root: string, skill: SkillDef): Promise<ResolvedSkill> {
  switch (skill.kind) {
    case "template":
      return { id: skill.id, kind: "template", executed: false, content: skill.content ?? "" };
    case "reference": {
      assertInside(root, skill.path ?? "");
      const content = await readFile(join(root, skill.path ?? ""), "utf8");
      return { id: skill.id, kind: "reference", executed: false, content };
    }
    case "script": {
      const script = skill.run?.script ?? "";
      assertInside(root, script);
      return {
        id: skill.id,
        kind: "script",
        executed: false,
        placeholder: `would run ${skill.run?.interpreter ?? "?"} ${script}`,
      };
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run -w @coala/agent-fs test -- src/__tests__/skills.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-fs/src/skills.ts packages/agent-fs/src/index.ts packages/agent-fs/src/__tests__/skills.test.ts
git commit -m "feat(agent-fs): resolveSkill (template/reference/script, execution deferred)"
```

---

## Task 9: `buildFileStores(root, agent)`

**Files:**
- Create: `packages/agent-fs/src/build-stores.ts`
- Modify: `packages/agent-fs/src/index.ts` (add `export { buildFileStores } from "./build-stores.js";`)
- Test: `packages/agent-fs/src/__tests__/build-stores.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/agent-fs/src/__tests__/build-stores.test.ts
import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { presets } from "@coala/core";
import { saveAgentFolder } from "../folder.js";
import { buildFileStores } from "../build-stores.js";

describe("buildFileStores", () => {
  it("creates one FileStore per long-term module", async () => {
    const retail = presets.find((p) => /retail/i.test(p.name))!;
    const root = await mkdtemp(join(tmpdir(), "coala-build-"));
    await saveAgentFolder(root, retail);
    const stores = buildFileStores(root, retail);
    const ltm = retail.memoryModules.filter((m) => m.kind !== "working");
    expect([...stores.keys()].sort()).toEqual(ltm.map((m) => m.id).sort());
    // A store is usable:
    const first = stores.get(ltm[0].id)!;
    expect(Array.isArray(await first.listPointers())).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run -w @coala/agent-fs test -- src/__tests__/build-stores.test.ts`
Expected: FAIL — `Cannot find module '../build-stores.js'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/agent-fs/src/build-stores.ts
import { join } from "node:path";
import type { Agent, Store } from "@coala/core";
import { FileStore } from "./file-store.js";
import { slugify } from "./paths.js";

/** Build a FileStore for each long-term module, rooted at the agent folder's memory tree. */
export function buildFileStores(root: string, agent: Agent): Map<string, Store> {
  const stores = new Map<string, Store>();
  for (const m of agent.memoryModules) {
    if (m.kind === "working") continue;
    const dir = join(root, "memory", m.kind, slugify(m.id));
    stores.set(m.id, new FileStore(dir, { name: m.name, kind: m.kind }));
  }
  return stores;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run -w @coala/agent-fs build && npm run -w @coala/agent-fs test -- src/__tests__/build-stores.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-fs/src/build-stores.ts packages/agent-fs/src/index.ts packages/agent-fs/src/__tests__/build-stores.test.ts
git commit -m "feat(agent-fs): buildFileStores — one FileStore per long-term module"
```

---

## Task 10: `InMemoryStore implements Store` (async) + re-export shared types

**Files:**
- Modify: `packages/runtime/src/memory.ts`
- Modify: `packages/runtime/src/index.ts`
- Test: `packages/runtime/src/__tests__/memory.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/runtime/src/__tests__/memory.test.ts
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../memory.js";

describe("InMemoryStore implements the async Store contract", () => {
  it("add → listPointers → openBody → retrieve", async () => {
    const s = new InMemoryStore([{ fact: "alpha" }]);
    const ptr = await s.add({ fact: "beta" });
    expect(typeof ptr.id).toBe("string");
    expect(await s.listPointers()).toHaveLength(2);
    const recent = await s.retrieve({ text: "", method: "recency", k: 1 });
    expect(recent).toEqual([{ fact: "beta" }]);
    expect(s.records).toHaveLength(2); // back-compat: synchronous array still present
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run -w @coala/runtime test -- src/__tests__/memory.test.ts`
Expected: FAIL — `s.add(...).id` is undefined / `listPointers` is not a function (current `add` is sync/void, no `listPointers`).

- [ ] **Step 3: Write minimal implementation**

Replace the body of `packages/runtime/src/memory.ts` from the `RRetrievalQuery`/`InMemoryStore` section onward with the version below. Keep `WorkingMemory`, `buildStores`, and `moduleById` (adjust `buildStores`' return type).

```ts
// packages/runtime/src/memory.ts
import type { Agent, MemoryModule } from "@coala/core";
import type { Store, Pointer, Record_, RecordMeta, RetrievalQuery } from "@coala/core";

// Re-export the shared storage types from core so existing `@coala/runtime` imports keep working.
export type { Store, Pointer, Record_, RecordMeta, RetrievalQuery } from "@coala/core";

/** Short-term hub: variables carried across the decision cycle (paper §4.1). */
export class WorkingMemory {
  private data = new Map<string, unknown>();
  set(key: string, value: unknown): void { this.data.set(key, value); }
  get(key: string): unknown { return this.data.get(key); }
  snapshot(): Record_ { return Object.fromEntries(this.data); }
}

function tokens(s: string): string[] {
  return s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}
function relevanceScore(query: string, record: Record_): number {
  const q = new Set(tokens(query));
  return tokens(JSON.stringify(record)).filter((t) => q.has(t)).length;
}
function summarize(record: Record_): string {
  return Object.values(record).filter((v) => typeof v === "string" || typeof v === "number").slice(0, 3).map(String).join(" · ") || "(record)";
}

/** In-memory long-term store. Retrieval mirrors paper §4.3. Ephemeral default + test double. */
export class InMemoryStore implements Store {
  readonly records: Record_[];
  constructor(seed: Record_[] = []) { this.records = [...seed]; }

  async add(record: Record_, _meta?: RecordMeta): Promise<Pointer> {
    this.records.push(record);
    const id = String(this.records.length - 1);
    return { id, summary: summarize(record), meta: {} };
  }
  async listPointers(): Promise<Pointer[]> {
    return this.records.map((r, i) => ({ id: String(i), summary: summarize(r), meta: r }));
  }
  async openBody(id: string): Promise<Record_ | undefined> {
    const i = Number(id);
    return Number.isInteger(i) ? this.records[i] : undefined;
  }
  async retrieve(q: RetrievalQuery): Promise<Record_[]> {
    const k = q.k;
    switch (q.method) {
      case "recency": return this.records.slice(-k).reverse();
      case "importance": return [...this.records].sort((a, b) => Number(b.importance ?? 0) - Number(a.importance ?? 0)).slice(0, k);
      case "relevance":
      case "embedding":
        return [...this.records].map((r) => ({ r, s: relevanceScore(q.text, r) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, k).map((x) => x.r);
      case "rule": return this.records.slice(0, k);
    }
  }
}

/** Build an in-memory store for each long-term module (seeded from the blueprint). */
export function buildStores(agent: Agent): Map<string, Store> {
  const stores = new Map<string, Store>();
  for (const m of agent.memoryModules) {
    if (m.kind === "episodic" || m.kind === "semantic" || m.kind === "procedural") {
      stores.set(m.id, new InMemoryStore(m.records.map((r) => r.data as Record_)));
    }
  }
  return stores;
}

export function moduleById(agent: Agent, id: string): MemoryModule | undefined {
  return agent.memoryModules.find((m) => m.id === id);
}
```

```ts
// packages/runtime/src/index.ts — replace the memory re-export block with:
export {
  WorkingMemory,
  InMemoryStore,
  buildStores,
  moduleById,
} from "./memory.js";
export type { Store, Pointer, Record_, RecordMeta, RetrievalQuery } from "@coala/core";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run -w @coala/core build && npm run -w @coala/runtime test -- src/__tests__/memory.test.ts`
Expected: PASS. (The executor in Task 11 will be updated to `await` these calls; the existing `runtime.test.ts` is updated in Task 11.)

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/memory.ts packages/runtime/src/index.ts packages/runtime/src/__tests__/memory.test.ts
git commit -m "feat(runtime): InMemoryStore implements async Store; share types from core"
```

---

## Task 11: Inject stores into `AgentRuntime`; await store calls; update existing test

**Files:**
- Modify: `packages/runtime/src/executor.ts`
- Modify: `packages/runtime/src/embedding.ts`
- Modify: `packages/runtime/src/__tests__/runtime.test.ts`

- [ ] **Step 1: Update the existing runtime test to the async interface**

In `packages/runtime/src/__tests__/runtime.test.ts`, replace the two synchronous assertions that read `.records` off a store with async pointer checks, and add a store-injection assertion:

```ts
// e.g. the assertion that was: expect(runtime.stores.get("mem-history")!.records).toHaveLength(1);
expect(await runtime.stores.get("mem-history")!.listPointers()).toHaveLength(1);

// e.g. the assertion that was: expect(runtime.stores.get("mem-catalog")!.records).toHaveLength(0);
expect(await runtime.stores.get("mem-catalog")!.listPointers()).toHaveLength(0);
```

Add one test confirming injection:

```ts
import { InMemoryStore } from "../memory.js";
it("uses injected stores when provided", async () => {
  const injected = new Map([["mem-history", new InMemoryStore([{ note: "seeded" }])]]);
  // construct the runtime with { stores: injected } alongside the existing options
  // then assert the injected store is the one used:
  // expect(runtime.stores.get("mem-history")).toBe(injected.get("mem-history"));
});
```

> Read the current `runtime.test.ts` first to wire the injection assertion into the existing setup (provider/tools already constructed there).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run -w @coala/runtime test -- src/__tests__/runtime.test.ts`
Expected: FAIL — `stores` option not accepted / injected store not used.

- [ ] **Step 3: Implement executor changes**

In `packages/runtime/src/executor.ts`:

1. Add to `RuntimeOptions`:
```ts
import type { Store } from "@coala/core";
export interface RuntimeOptions {
  maxSteps?: number;
  embedder?: EmbeddingProvider;
  /** Pre-built stores (e.g. FileStore from @coala/agent-fs). Defaults to in-memory. */
  stores?: Map<string, Store>;
  /** After a turn, write a rubric-scored trajectory to a writable episodic module. */
  captureEpisodes?: boolean;
}
```

2. Change the field + constructor:
```ts
readonly stores: Map<string, Store>;
// in constructor:
this.stores = opts.stores ?? buildStores(agent);
```

3. Make `retrieve()` await the store, and rank embeddings over pointer summaries (no full-body scan):
```ts
private async retrieve(query: string): Promise<RetrievedItem[]> {
  const items: RetrievedItem[] = [];
  for (const { grant, module } of this.retrievalGrants()) {
    const store = this.stores.get(module.id);
    if (!store) continue;
    const method = grant.retrieval.method ?? module.retrievalConfig?.method ?? "relevance";
    const k = module.retrievalConfig?.k ?? 5;
    let records: Record_[];
    if (method === "embedding" && this.embeddingIndex) {
      const pointers = await store.listPointers();
      const winners = await this.embeddingIndex.rankPointers(pointers, query, k);
      records = [];
      for (const p of winners) {
        const body = await store.openBody(p.id);
        if (body) records.push(body);
      }
    } else {
      records = await store.retrieve({ text: query, method, k });
    }
    items.push({ moduleId: module.id, moduleName: module.name, method, records });
  }
  return items;
}
```

4. Make `applyLearning` async + await the store write:
```ts
private async applyLearning(moduleId: string | undefined, record: Record_) {
  if (!moduleId) return "No memoryModuleId provided.";
  const grant = this.agent.accessPolicy.find((a) => a.memoryModuleId === moduleId);
  if (!grant?.learning.add) return `Module "${moduleId}" is not writable (no learning grant).`;
  const store = this.stores.get(moduleId);
  const module = moduleById(this.agent, moduleId);
  if (!store || !module) return `Module "${moduleId}" has no store.`;
  await store.add(record);
  return { moduleId, moduleName: module.name, record };
}
```
…and in `runTurn`, change the learning case to `const write = await this.applyLearning(...)`.

In `packages/runtime/src/embedding.ts`, add `rankPointers` (rank pointer summaries; reuse the existing cosine/embed logic):
```ts
import type { Pointer } from "@coala/core";
// inside class EmbeddingIndex:
async rankPointers(pointers: Pointer[], query: string, k: number): Promise<Pointer[]> {
  if (pointers.length === 0) return [];
  const [q, ...docs] = await this.embedder.embed([query, ...pointers.map((p) => p.summary)]);
  return pointers
    .map((p, i) => ({ p, s: cosine(q, docs[i]) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map((x) => x.p);
}
```

> Confirm the embedder method name first: `grep -n "embed" packages/runtime/src/embedding.ts packages/providers/src/*.ts`. If it is `embedBatch`/`embedMany`, use that name. Keep the existing `rank(records, …)` method intact for back-compat.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run -w @coala/runtime test`
Expected: PASS (memory.test.ts, runtime.test.ts, mcp.test.ts, embedding.test.ts).

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/executor.ts packages/runtime/src/embedding.ts packages/runtime/src/__tests__/runtime.test.ts
git commit -m "feat(runtime): inject stores; async retrieve/learning; embedding ranks pointers"
```

---

## Task 12: `memory.open` built-in tool

**Files:**
- Modify: `packages/runtime/src/executor.ts`
- Test: `packages/runtime/src/__tests__/memory-open.test.ts`

Register a built-in grounding tool named `memory.open` that the agent can call with `{ moduleId, id }` to pull a specific record body on demand.

- [ ] **Step 1: Write the failing test**

```ts
// packages/runtime/src/__tests__/memory-open.test.ts
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../memory.js";
import { ToolRegistry } from "../tools.js";
import { registerMemoryOpen } from "../executor.js";

describe("memory.open tool", () => {
  it("opens a record body by moduleId + id", async () => {
    const stores = new Map([["m1", new InMemoryStore([{ fact: "zero" }, { fact: "one" }])]]);
    const reg = new ToolRegistry();
    registerMemoryOpen(reg, stores);
    const obs = await reg.run("memory.open", { moduleId: "m1", id: "1" }, { working: {} as any });
    expect(obs).toEqual({ fact: "one" });
  });
});
```

> Confirm `ToolRegistry.run` and `register` signatures first: `sed -n '1,80p' packages/runtime/src/tools.ts`. Match the existing `register(name, handler)` / `run(name, args, ctx)` shapes.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run -w @coala/runtime test -- src/__tests__/memory-open.test.ts`
Expected: FAIL — `registerMemoryOpen` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `packages/runtime/src/executor.ts`, export a helper and call it in the constructor:

```ts
import type { Store } from "@coala/core";
import type { ToolRegistry } from "./tools.js";

/** Register the built-in `memory.open` tool: pull one record body by moduleId + id. */
export function registerMemoryOpen(tools: ToolRegistry, stores: Map<string, Store>): void {
  tools.register("memory.open", async (args) => {
    const moduleId = String((args as Record<string, unknown>).moduleId ?? "");
    const id = String((args as Record<string, unknown>).id ?? "");
    const store = stores.get(moduleId);
    if (!store) return { error: `Unknown module "${moduleId}".` };
    const body = await store.openBody(id);
    return body ?? { error: `No record "${id}" in "${moduleId}".` };
  });
}
```

In the `AgentRuntime` constructor, after `this.stores = …`:
```ts
registerMemoryOpen(this.tools, this.stores);
```

> Adjust the `tools.register(...)` callback signature to match `ToolHandler` exactly (it may receive `(args, ctx)`). If `register` rejects a dotted name, use `memory_open` and note the name in the README.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run -w @coala/runtime test -- src/__tests__/memory-open.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/executor.ts packages/runtime/src/__tests__/memory-open.test.ts
git commit -m "feat(runtime): memory.open tool for on-demand record fetch"
```

---

## Task 13: Episodic capture (post-turn rubric-scored reflection)

**Files:**
- Modify: `packages/runtime/src/executor.ts`
- Test: `packages/runtime/src/__tests__/episodic-capture.test.ts`

When `captureEpisodes` is set and the agent has a **writable episodic** module, after a turn make one structured LLM call to score the turn against the module's `rubric` and answer its `reflectionPrompts`, then `store.add()` a trajectory record.

- [ ] **Step 1: Write the failing test**

```ts
// packages/runtime/src/__tests__/episodic-capture.test.ts
import { describe, it, expect } from "vitest";
import { MockProvider } from "@coala/providers";
import { InMemoryStore } from "../memory.js";
import { AgentRuntime } from "../executor.js";
import type { Agent } from "@coala/core";

// Minimal agent with a writable episodic module.
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

it("writes a rubric-scored episode after the turn", async () => {
  // First completion = the turn's action (respond); second = the reflection capture.
  const provider = new MockProvider({
    structured: [
      { thought: "reply", action: { type: "respond", message: "Hello!" } },
      { data: { observation: "user greeted", action: "respond", result: "Hello!" }, rubricScores: { resolved: true }, reflection: "User wanted a greeting." },
    ],
  });
  const ep = new InMemoryStore([]);
  const rt = new AgentRuntime(agent, provider, undefined, { stores: new Map([["ep", ep]]), captureEpisodes: true });
  await rt.runTurn("hi");
  expect(await ep.listPointers()).toHaveLength(1);
});
```

> Confirm the `MockProvider` scripting API first: `sed -n '1,80p' packages/providers/src/mock.ts` (or wherever `MockProvider` lives). Match how it queues `completeStructured` responses — adapt the `structured: [...]` shape to the real constructor.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run -w @coala/runtime test -- src/__tests__/episodic-capture.test.ts`
Expected: FAIL — no episode written (capture not implemented).

- [ ] **Step 3: Write minimal implementation**

In `packages/runtime/src/executor.ts`, at the end of `runTurn`, before `return`:

```ts
if (this.opts.captureEpisodes) {
  await this.captureEpisode(input, reply, steps);
}
```

Add the method (define a small zod schema for the reflection call):

```ts
import { z } from "zod";

private episodicTarget() {
  for (const grant of this.agent.accessPolicy) {
    if (!grant.learning.add) continue;
    const module = moduleById(this.agent, grant.memoryModuleId);
    if (module?.kind === "episodic") return module;
  }
  return undefined;
}

private async captureEpisode(input: string, reply: string | null, steps: CycleStep[]): Promise<void> {
  const module = this.episodicTarget();
  const store = module && this.stores.get(module.id);
  if (!module || !store) return;
  const rubric = module.rubric ?? { criteria: [], reflectionPrompts: [] };

  const Schema = z.object({
    data: z.record(z.string(), z.unknown()),
    rubricScores: z.record(z.string(), z.unknown()).default({}),
    reflection: z.string().default(""),
  });
  const prompt = {
    system: "You record a past episode into episodic memory. Score it against the rubric and reflect.",
    messages: [{
      role: "user" as const,
      content:
        `User said: ${input}\nAgent replied: ${reply ?? "(none)"}\n` +
        `Steps: ${JSON.stringify(steps.map((s) => ({ thought: s.thought, action: s.action })))}\n` +
        `Rubric criteria: ${JSON.stringify(rubric.criteria)}\n` +
        `Reflection prompts: ${JSON.stringify(rubric.reflectionPrompts)}\n` +
        `Return { data, rubricScores, reflection }.`,
    }],
  };
  const ep = await this.provider.completeStructured(prompt, Schema);
  await store.add(
    { ...ep.data, rubricScores: ep.rubricScores },
    { source: "runtime", body: ep.reflection ? `## Reflection\n${ep.reflection}\n` : "" },
  );
}
```

> Match the `completeStructured(request, schema)` request shape to `reasonRequest`'s shape in `prompt.ts` (system/messages vs a flat prompt string). Read `packages/runtime/src/prompt.ts` and mirror it.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run -w @coala/runtime test -- src/__tests__/episodic-capture.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/executor.ts packages/runtime/src/__tests__/episodic-capture.test.ts
git commit -m "feat(runtime): post-turn episodic capture (rubric-scored reflection)"
```

---

## Task 14: Persistence integration — memory survives turns AND restart (the money test)

**Files:**
- Test: `packages/agent-fs/src/__tests__/persistence.integration.test.ts`

This test proves the headline value with `FileStore` end to end: a learned record persists to disk, a second turn retrieves it, and a **fresh runtime on the same folder** (simulated restart) still has it.

- [ ] **Step 1: Write the failing test**

```ts
// packages/agent-fs/src/__tests__/persistence.integration.test.ts
import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockProvider } from "@coala/providers";
import { AgentRuntime } from "@coala/runtime";
import type { Agent } from "@coala/core";
import { saveAgentFolder, loadAgentFolder, buildFileStores } from "../index.js";

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

it("persists a learned record across a turn and a restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "coala-persist-"));
  await saveAgentFolder(root, agent);

  // Turn 1: the agent learns a fact, then responds.
  const p1 = new MockProvider({
    structured: [
      { thought: "remember", action: { type: "learning", memoryModuleId: "notes", record: { fact: "user likes tea" } } },
      { thought: "reply", action: { type: "respond", message: "Noted." } },
    ],
  });
  const rt1 = new AgentRuntime(agent, p1, undefined, { stores: buildFileStores(root, agent) });
  await rt1.runTurn("I like tea");

  // Restart: brand-new runtime on the same folder.
  const { agent: reloaded } = await loadAgentFolder(root);
  expect(reloaded.memoryModules.find((m) => m.id === "notes")!.records).toHaveLength(1);

  const rt2 = new AgentRuntime(reloaded, new MockProvider({ structured: [{ thought: "reply", action: { type: "respond", message: "tea" } }] }), undefined, { stores: buildFileStores(root, reloaded) });
  const retrieved = await rt2.stores.get("notes")!.retrieve({ text: "tea", method: "recency", k: 5 });
  expect(retrieved).toContainEqual({ fact: "user likes tea" });
});
```

> Adapt the `MockProvider` `structured` scripting to the real API (same as Task 13). Confirm `@coala/runtime` is a devDependency of `@coala/agent-fs` for this test; if not, add `"@coala/runtime": "*"` and `"@coala/providers": "*"` to `agent-fs` devDependencies and re-run `npm install`.

- [ ] **Step 2: Run test to verify it fails (or wire deps first)**

Run: `npm run -w @coala/agent-fs test -- src/__tests__/persistence.integration.test.ts`
Expected: FAIL initially — missing `@coala/runtime`/`@coala/providers` dep, or memory not persisted. Add the devDeps, `npm install`, build core/providers/runtime, then re-run.

- [ ] **Step 3: Make it pass**

No new product code should be needed — Tasks 6–11 already implement persistence. If it fails on retrieval, debug the `FileStore.add → reindex → listPointers` path (the most likely culprit is the `_index.md` `records` array not being refreshed). Fix in `file-store.ts`/`reindex.ts`.

- [ ] **Step 4: Run the full suite**

Run: `npm run -w @coala/core build && npm run -w @coala/providers build && npm run -w @coala/runtime build && npm run -w @coala/agent-fs build && npm test`
Expected: PASS across all packages.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-fs/package.json packages/agent-fs/src/__tests__/persistence.integration.test.ts package-lock.json
git commit -m "test(agent-fs): memory persists across turn + restart (integration)"
```

---

## Self-Review

**Spec coverage:**
- Files-for-everything portable folder → Task 7 (`save/loadAgentFolder`). ✓
- By-module tree (`_schema.yaml`/`_rubric.yaml`/`_index.md` + one file per record) → Tasks 5, 7. ✓
- Both retrieval modes: always-loaded index + auto top-k + explicit open → master index is `memory/index.md` produced by `saveAgentFolder`; module `_index.md` ranking in Task 6; `memory.open` tool in Task 12. ✓ *(Gap noted below: `saveAgentFolder` must also write the master `memory/index.md`.)*
- Skills format + pointers, execution deferred → Task 8. ✓
- Store interface in core, async, lean/lazy → Tasks 1, 6, 10. ✓
- Runtime injection + persistence + episodic capture → Tasks 11, 13, 14. ✓
- Error handling: schema-lenient load, reindex drift repair, atomic writes, path traversal → Tasks 4, 5, 6, 7. ✓
- Embedding ranks pointer summaries (deferred per-record vectors) → Task 11. ✓
- Web local-mode + SQLite migration → **explicitly deferred to the sequel plan** (stated in header). ✓

**Gap found & fixed inline:** the master `memory/index.md` (module-level catalog, always loaded) was implied but no task wrote it. Add this step to **Task 7, Step 3** (`saveAgentFolder`), after the per-module loop:

```ts
// Write the master index (module-level pointers, always loaded by the runtime context builder).
const lines = agent.memoryModules
  .filter((m) => m.kind !== "working")
  .map((m) => `- **${m.name}** (${m.kind}) — ${m.description || "(no description)"} · ${m.records.length} records`);
await writeFile(join(root, "memory", "index.md"), `# Memory Index\n\n${lines.join("\n")}\n`);
```
And add an assertion to Task 7's test: `expect(await readFile(join(root, "memory", "index.md"), "utf8")).toContain("Memory Index");` (import `readFile` from `node:fs/promises`).

> Loading the master index into the LLM context each cycle (vs. it merely existing on disk) is a **runtime context-builder** concern. Wiring it into `reasonRequest`/`prompt.ts` is a small follow-on; this plan guarantees the file exists and is the catalog. Track it as the first item of the sequel plan if not done opportunistically in Task 11.

**Placeholder scan:** No "TBD"/"handle edge cases"/"similar to" — each code step has concrete code. The "confirm signature first" notes point at real files to read, not deferred work. ✓

**Type consistency:** `Store`/`Pointer`/`RecordMeta`/`Record_`/`RetrievalQuery` defined once in Task 1 and imported everywhere (Tasks 6, 9, 10, 11, 12). `ModuleRef` defined in Task 5, reused in Tasks 6, 9. `reindexModule(dir, ref)` signature consistent across Tasks 5/6/7. `buildFileStores(root, agent)` consistent Tasks 9/14. `registerMemoryOpen(tools, stores)` consistent Tasks 12. ✓

---

## Out of scope (sequel plan: `web-local-mode-adoption`)

- `/api/run` loads an agent folder, injects `buildFileStores`, persists writes; local-mode auth bypass.
- Loading the master `memory/index.md` into the LLM context each cycle (context-builder wiring).
- One-time SQLite `Blueprint` → agent-folder migration.
- Run panel as multi-turn chat to surface accumulating memory.
- Approach-C optimization: persistent embedding/summary cache + file watcher.
- `script`-skill execution (security-scoped).
