# File-Based Memory Tree — Design Spec

> **Status:** Approved design, pre-implementation.
> **Date:** 2026-06-03
> **Context:** Realizes "Phase A — make memory real" from `DELTA-REPORT.md`, replacing the
> never-built SQLite persistence idea with a portable markdown/YAML agent folder.

## Goal

Deliver the product's headline promise — **an agent whose memory gets better over time** — by
making a CoALA agent a **self-contained folder on disk** (markdown + YAML) that is the source of
truth for the blueprint *and* its living memory. Learning writes persist immediately; episodic
trajectories accumulate and are reflected on, so each session starts smarter than the last. The
folder is portable (zip / `git` / share) and the format is human-readable, which also removes the
SQLite `db:migrate` step the delta report flagged as a top install barrier for non-technical users.

## Decisions locked in

1. **Files for everything** — the agent folder is the source of truth; SQLite is no longer the
   persistence backbone for blueprints or memory.
2. **By-module tree** — each `MemoryModule` is its own folder with its schema/rubric, a local
   index, and one file per record (faithful to CoALA: an agent may have several modules per kind).
3. **Both retrieval modes** — a master `index.md` is always loaded (pointers only, cheap); each
   cycle auto-retrieves top-k record bodies (lazy); and an explicit `memory.open` tool lets the
   agent pull a specific pointer by hand.
4. **Skills: format + pointers now, execution deferred** — define the skill format and pointer
   resolution (template / reference / script); a `script` skill is resolved and surfaced but
   returns a "would run" placeholder instead of executing. Execution is a later, security-scoped
   round.
5. **Keep auth, bypass in local mode** — retain the existing auth/workspace code, but add a
   local mode that auto-creates an implicit single user, skips login, and reads/writes agent
   folders under a workspace directory. Door stays open to a hosted multi-user deployment later.

## Approach (chosen: A)

Make the `Store` an **interface** so the runtime is agnostic to whether memory lives in RAM or on
disk. A new `@coala/agent-fs` package implements a file-backed `FileStore` plus an agent-folder
(de)serializer. `AgentRuntime` accepts injected stores (defaults to in-memory, preserving existing
behaviour). Considered and rejected: (B) load-all-into-RAM + write-back — defeats the lean/lazy
goal; (C) A + persistent embedding/summary cache + file watcher — premature, layer on later (YAGNI).

## Architecture & package boundaries

```
@coala/core        Store INTERFACE + existing domain types (Agent, MemoryModule, EpisodeRubric…)
   ↑          ↑
@coala/runtime   @coala/agent-fs   (NEW)
   │                ├─ folder.ts      agent.md  ⇄  Agent   (load/save the portable folder)
   │                ├─ file-store.ts  FileStore implements Store  (lean index + lazy bodies + write-back)
   │                ├─ skills.ts      resolve skill pointers (template / reference / script — exec deferred)
   │                └─ reindex.ts     regenerate _index.md from record frontmatter (drift repair)
   │
   └─ InMemoryStore now `implements Store`; AgentRuntime takes injected stores (defaults to InMemory)

apps/web/api/run  → loads folder via agent-fs, injects FileStores, runs, writes persist automatically
                    local-mode flag bypasses login, reads/writes agent folders under a workspace dir
```

Rationale: putting `Store` in **core** (not runtime) breaks the dependency cycle — both
`InMemoryStore` (runtime) and `FileStore` (agent-fs) implement a contract neither owns, and the
executor's retrieve/learn code never changes. The interface is **async** so `FileStore` does real
I/O while `InMemoryStore` wraps its sync logic; existing runtime tests keep passing on the default.

## File formats

Every file is **YAML frontmatter (the structured, rankable truth) + markdown body (free-form notes
the agent reads/writes)**. Record frontmatter is the single source of truth; every `_index.md` is
**generated** from it (disposable, self-healing).

### Directory shape

```
my-agent/
  agent.md                # blueprint: goals, provider, decision procedure (YAML + prose)
  memory/
    index.md              # MASTER index — module-level pointers only, always loaded
    semantic/
      products/           # one folder per semantic module
        _schema.yaml      # the record "model"
        _index.md         # generated per-record pointers (rankable metadata + summary)
        widget-x.md       # one record (YAML frontmatter + notes)
    episodic/
      conversations/
        _schema.yaml
        _rubric.yaml      # EpisodeRubric: criteria + reflectionPrompts
        _index.md
        2026-06-03T0830.md  # one trajectory/episode
    procedural/
      skills/
        _index.md
        greet-customer.md   # skill: template
        lookup.skill.yaml   # skill: script pointer (execution deferred)
  scripts/
    lookup.py             # runnable script a skill can reference (not executed this round)
```

### `agent.md` (maps to the `Agent` zod type)

```markdown
---
coalaVersion: 1
id: retail-assistant
name: Retail Assistant
provider: { provider: anthropic, model: claude-opus-4-8 }
goals: [Help users find products, Remember past purchases to personalize]
decisionProcedure: { style: react, planning: {...}, executionPolicy: ... }
grounding:
  - { type: dialogue }
  - { type: digital, digitalTools: [{ name: search_catalog, description: ..., schema: {...} }] }
accessPolicy:                          # references modules by PATH; loader maps path⇄id
  - { module: semantic/products,      retrieval: {enabled: true, method: relevance}, learning: {add: false} }
  - { module: episodic/conversations, retrieval: {enabled: true, method: recency},   learning: {add: true} }
---
# Retail Assistant
<the natural-language spec the user typed, plus notes>
```

### `memory/index.md` (master index — module-level pointers, always loaded)

```markdown
# Memory Index
## Semantic
- **products** — Catalog of sellable products · schema: semantic/products/_schema.yaml · 142 records · retrieval: relevance
## Episodic
- **conversations** — Past dialogue trajectories · rubric: episodic/conversations/_rubric.yaml · 37 records · retrieval: recency
## Procedural
- **skills** — 4 skills → procedural/skills/_index.md
```

### `semantic/products/_schema.yaml` (the record "model"; validates each record's `data`)

```yaml
title: Product
type: object
properties: { name: {type: string}, price: {type: number}, tags: {type: array, items: {type: string}} }
required: [name, price]
```

### `semantic/products/_index.md` (generated per-record pointers — what FileStore ranks over)

```markdown
# products — index
- [widget-x](widget-x.md) — Widget X · $19.99 · gadget,home · importance: 0.8
- [gizmo-pro](gizmo-pro.md) — Gizmo Pro · $49 · importance: 0.5
```

### `semantic/products/widget-x.md` (one record; `data` validated against `_schema.yaml`)

```markdown
---
id: widget-x
source: seed            # seed | inferred | runtime
created: 2026-06-03T08:30:00Z
importance: 0.8
data: { name: Widget X, price: 19.99, tags: [gadget, home] }
---
Widget X is our entry-level gadget. <free-form notes the agent can read/append>
```

### `episodic/conversations/_rubric.yaml` (the existing `EpisodeRubric`)

```yaml
criteria:
  - { name: resolved,  description: Did the conversation resolve the user's request? }
  - { name: sentiment, description: User sentiment at the end. }
reflectionPrompts: [What did the user actually want?, What would I do differently next time?]
```

### `episodic/conversations/2026-06-03T0830.md` (one trajectory)

```markdown
---
id: 2026-06-03T0830
source: runtime
created: 2026-06-03T08:30:00Z
importance: 0.6
data: { observation: "User wanted a quiet keyboard < $80", action: "search_catalog(...)", result: "Bought Model K" }
rubricScores: { resolved: true, sentiment: positive }
---
## Reflection
User valued quiet over price — remember acoustic preference for returning users.
```

### Procedural skills (three pointer kinds; execution deferred)

```markdown
# procedural/skills/greet-customer.md  (kind: template)
---
id: greet-customer
kind: template
---
Hello {{name}}, welcome back! Last time you looked at {{lastItem}}.
```

```yaml
# procedural/skills/lookup.skill.yaml  (kind: script — RESOLVED but not executed yet)
id: lookup
kind: script
description: Look up live inventory for a SKU.
inputs: { sku: {type: string} }
run: { interpreter: python, script: ../../scripts/lookup.py }   # path confined to agent root; returns "would run" placeholder
```

A third kind, `reference`, points at another `.md`/`.yaml`: `{ id, kind: reference, path: ... }`.

### Cost-tiering principle

Three widening rings: master index (always) → a module's `_index.md` (only when retrieving from
that module) → full record bodies (only top-k winners). Context cost scales with relevance, not
total memory size.

## Components & interfaces

### `Store` interface (in `@coala/core`)

```ts
export interface Pointer { id: string; summary: string; meta: Record<string, unknown>; } // meta: importance, created, …
export interface RecordMeta { source?: RecordSource; importance?: number; body?: string; }

export interface Store {
  listPointers(): Promise<Pointer[]>;                 // cheap: frontmatter/index only, no bodies
  openBody(id: string): Promise<Record_ | undefined>; // lazy: one full record on demand
  retrieve(q: RetrievalQuery): Promise<Record_[]>;    // rank pointers, open top-k bodies
  add(record: Record_, meta?: RecordMeta): Promise<Pointer>; // persist + return its pointer
}
```

- **`InMemoryStore`** (runtime): keeps current ranking logic, wrapped async; `listPointers` derives
  from in-RAM records. Remains the ephemeral default and test double.
- **`FileStore`** (`agent-fs/file-store.ts`), constructed with `{ moduleDir, module }`:
  - `listPointers()` parses the module's `_index.md` (scans record frontmatter if index missing/stale).
  - `retrieve()` ranks pointers by the configured method (recency / importance / relevance /
    embedding / rule), then `openBody()`s only the winners. Embedding ranks over pointer summaries
    for the first cut (true per-record vectors = deferred cache).
  - `add()` writes `<id>.md` atomically (temp + rename), appends to `_index.md`, returns the `Pointer`.
- **`folder.ts`**: `loadAgentFolder(root) → { agent, root }` parses `agent.md` + walks `memory/` and
  runs `parseAgent()` (every load validated). `saveAgentFolder(root, agent)` writes `agent.md`,
  schemas/rubrics, and seed records. Path⇄id mapping lives here.
- **`skills.ts`**: `resolveSkill(root, skill)` — `template` → content; `reference` → target file
  contents; `script` → validate path is inside the agent root, return
  `{ resolved: true, executed: false, placeholder: "would run python ..." }`.
- **Runtime change**: `AgentRuntime` gains an injected store map and a built-in **`memory.open`**
  tool wrapping `store.openBody`:
  `new AgentRuntime(agent, llm, tools, { stores, embedder, captureEpisodes: true })` — `stores?:
  Map<moduleId, Store>` defaults to in-memory (existing behaviour preserved).

## Data flow (one turn, end to end)

```
load:   loadAgentFolder(root) → Agent (parseAgent)        buildFileStores(root, agent) → Map<id, FileStore>
        new AgentRuntime(agent, llm, tools, { stores, embedder, captureEpisodes })

turn:   working.set("input")
   ┌─ each cycle ──────────────────────────────────────────────────────────────┐
   │  context = working + memory/index.md (always)                              │
   │          + auto-retrieved top-k bodies per readable module (lean→lazy)     │
   │  tools  += memory.open(pointer)  +  skills catalog                          │
   │  proposal = llm.completeStructured(...)                                     │
   │  • grounding → run tool                                                     │
   │  • learning  → store.add()  ⇒  writes <id>.md + updates _index.md  (PERSISTS)│
   │  • respond/finish → break                                                   │
   └────────────────────────────────────────────────────────────────────────────┘

after:  if captureEpisodes && an episodic module is writable:
          one LLM call scores the turn against _rubric.yaml + answers reflectionPrompts
          → store.add() a trajectory record  (the "gets better over time" engine)
```

Learning writes persist **mid-turn**, not at the end — no flush step, no construct-and-discard.
The post-turn episodic-capture step is the improvement loop and reuses `EpisodeRubric`; it is gated
by `captureEpisodes` so non-episodic agents pay nothing.

## Error handling & edge cases

| Case | Handling |
|---|---|
| Record fails its `_schema.yaml` | Skip + warn in run trace; never crash the turn. Load lenient, `add` strict (validate before write). |
| Index drift (hand-edited record files) | `reindex.ts` regenerates `_index.md` from record frontmatter; auto-runs on load when index count ≠ file count. Index is always disposable. |
| Concurrent turns on one folder | Atomic writes (temp + rename); per-module index updates serialized. Low contention locally; documented, not over-engineered. |
| Path traversal in skill `script`/`reference` | Resolve and assert target is inside agent root; reject `../` escapes even though execution deferred. |
| Missing/corrupt `agent.md` | Hard error with clear message; `parseAgent` reports the offending field. |
| Filename safety | Record `id`s slugified to safe filenames; collisions get a numeric suffix. |
| Existing SQLite blueprints | One-time `migrate` reads `Blueprint` rows → writes agent folders, so no data is stranded. |

## Testing (execution, not just compilation — per repo convention)

- **Folder round-trip:** `Agent → saveAgentFolder → loadAgentFolder → Agent` structurally identical,
  for **all six Table 2 presets** (they are the executable spec).
- **FileStore unit:** `listPointers`/`openBody`/`retrieve` per method against a fixture tree; `add()`
  writes the file *and* updates `_index.md`; `reindex()` reconciles deliberate drift.
- **Persistence integration (the money test):** scripted `MockProvider` emits a learning action →
  assert record file on disk → run a **second turn** and assert retrieval → construct a **fresh
  `AgentRuntime` on the same folder** (restart) and assert memory survived. Proves "better over
  time" across turns *and* sessions.
- **Episodic capture:** after a turn, assert a rubric-scored trajectory file with reflection content.
- **Skills:** `template`/`reference` resolve to content; `script` returns the deferred placeholder
  and rejects a path-escape.
- **Web:** `/api/run` in local mode loads a folder, runs, writes back; a second call sees prior memory.

## Out of scope (this round)

- **Script execution** for `script` skills (resolved + surfaced only; security-scoped follow-on).
- **Persistent embedding/summary cache + file watcher** (Approach C optimization).
- **Desktop wrapper / installer** (delta report Phase B — separate spec).
- **Multi-turn chat UI** for the Run panel (separate UI round; this delivers the persistence engine
  the chat would sit on).
- **Hosted multi-user deployment** (local mode is the target; auth code retained but bypassed).

## Relationship to the delta report

Closes the report's #1 critical gap ("memory does not persist or improve over time") end to end,
and removes the manual `db:migrate` install barrier by making the agent folder the unit of
persistence. The contract-first architecture means this bolts onto `@coala/core` without rework.
