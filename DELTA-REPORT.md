<!-- Generated 2026-06-03 by a multi-agent delta-report workflow (11 agents). Compares PLAN.md against the built code at commit b3a188b. -->

# CoALA Agent Builder — Delta Report

## 1. Executive Summary

The CoALA Agent Builder has been built **faithfully and substantially against PLAN.md** — but PLAN.md was never written to serve the stated product goal. Measured against the plan, this is an impressive, near-complete delivery: a CoALA-faithful domain model, five-provider LLM layer, three-pass inference engine, a fully wired Next.js designer with progressive-disclosure UI and verbatim-paper "Why?" popovers, multi-tenant auth/persistence, a working runtime decision cycle, and runnable-agent export bundles in seven languages. The core library layers (`@coala/core`, `@coala/providers`, `@coala/inference`, `@coala/export`) are genuinely strong and tested.

**Measured against the actual product goal — a thing a NON-TECHNICAL user downloads, installs, and runs locally to create, use, and improve an AI agent whose memory gets better over time — the project is not shippable, and the gap is not small.** Two pillars of that goal are effectively missing end-to-end:

1. **Frictionless install does not exist at all.** There is no installer, no desktop wrapper, no Docker image, no bundled runtime, no one-click anything. Getting the app running requires installing a specific Node version, an ordered multi-package build, a hand-edited `.env`, and a manual database migration — every step a terminal command. This is a developer setup, not a consumer product. PLAN.md itself never specified this goal, so neither plan nor code addresses it.

2. **Memory does not persist or improve over time.** This is the headline value proposition, and it is not delivered. Learning writes go to an in-process `InMemoryStore` that is rebuilt from the blueprint's static seed on **every single HTTP request** and discarded when the request returns. There is no memory-record table in the database, no write-back path, and no cross-turn — let alone cross-session — continuity. The UI shows green "wrote to memory" trace lines that are immediately thrown away, which is actively misleading about the product's central promise.

**Blunt verdict:** The framework, the modeling, and the designer are roughly 85–90% of a great *developer-facing CoALA design tool*. As the *consumer product the goal describes*, it is perhaps 30–40% there: the create loop works (for someone who can stand up the toolchain and paste an API key), but the "use it locally with no terminal" and "memory that gets better over time" halves — the two things the goal hinges on — are unbuilt. Distance-to-shippable is measured in significant net-new work (persistence layer + packaging/installer), not polish.

---

## 2. Scorecard

| Area | Status | What's done | Key gap |
|---|---|---|---|
| **Core** (schema/lint/presets) | ✅ Done | All §2 fields zod-validated, `parseAgent()` single entry, all 6 Table 2 presets faithful, 8 linter invariants, 34/34 tests pass | Record-vs-schema validation deferred to app layer; pure-reasoning grounding exemption is a hard error not a soft flag |
| **Providers** | ✅ Done | All 5 providers (Anthropic/Google + OpenAI-compatible for openai/xai/ollama/local), generic structured output, MockProvider, server-only secrets, 12/12 tests | No streaming; no usage/cost telemetry; adapter HTTP shaping untested |
| **Inference** | ✅ Done | Three §6 passes wired end-to-end, assembler to canonical Agent, rationale layer, diff-on-reinfer (in web), 5/5 tests | No mid-pass edit checkpoint; style selection is prompt-driven not rule-enforced; diff/merge has zero test coverage |
| **Runtime** | ⚠️ Partial | `runTurn()` decision cycle, all 5 retrieval methods, real cosine embeddings, access-policy-enforced writes, MCP stdio+HTTP | **No persistence**; only propose→execute (no Evaluate/Select); learning is add-only (no modify/delete); `decisionProcedure` never read at runtime |
| **Export** | ✅ Mostly | JSON/YAML/JSON-Schema serializers, TS+LangGraph codegen, 7-language runnable bundles with embedded runtimes, 15 tests | LangGraph JS missing (Python only); no LlamaIndex/OpenAI-tools; no automated bundle-execution test; C# unverified; bundles don't persist memory |
| **Web/Designer** | ✅ Mostly | Full describe→infer→CRUD→run→export→save→share loop, beginner Workspace + Expert board, Why popovers, live re-lint, typechecks clean | No in-app API-key entry; Run panel is single-turn not chat; no Inspector drawer; memory doesn't persist between runs |
| **Auth & Persistence** | ✅ Mostly | bcrypt + DB-backed sessions, workspaces/invites/roles, blueprint CRUD, linear version history, share tokens, server-only secrets | No version restore/diff endpoint; share edit-grant is dead config; no revocation/reset/rate-limiting; no local single-user mode |
| **Distribution/Install** | ❌ Missing | SQLite local default, keyless presets, offline embedder/Ollama path | **Nothing exists**: no installer, desktop wrapper, Docker, bundled Node, launcher script, or CI/release pipeline |
| **Memory-over-time** | ❌ Missing | Within-turn retrieve→write→retrieve works; writes are access-policy-enforced and surfaced in trace | **No persistence end-to-end**: no DB record model, no write-back from `/api/run`, no cross-turn/session accumulation |

---

## 3. What Was Built As Planned (the solid foundation)

The library spine of the plan is built, tested, and sound.

- **`packages/core` is the strongest area and complete.** Every §2 `Agent` field is present and zod-validated across `schema/{common,memory,action,decision,agent}.ts`, with `parseAgent()` (`agent.ts:45`) as the single validation entry. All six Table 2 presets exist as `Agent.parse({...})` constructions and map faithfully to the paper (verified: Retail Assistant episodic write-only + semantic read-only; SayCan procedural-only LTM with physical grounding; ToT no-LTM single-tool propose+evaluate+select; Voyager skill library with embedding retrieval). All eight §7 linter invariants are implemented as discrete rules in `invariants/lint.ts`. **34/34 tests pass.**

- **`packages/providers` matches the plan exactly.** A single `LLMProvider` interface (`types.ts`), all five promised providers via three fetch-based adapters (no vendor SDKs — confirmed by grep), generic structured output via `completeStructuredVia` (`structured.ts`) with schema→JSON-Schema→validate→re-ask retry, `MockProvider` test double, and server-only `credentialsFromEnv` (`env.ts`). **12/12 tests pass.**

- **`packages/inference` delivers the §6 three-pass engine.** `inferBlueprint` (`infer.ts`) runs Memory→Access→Decision as chained `completeStructured` calls, then `assembleAgent` (`assemble.ts`) maps drafts to a canonical validated `Agent` (auto-seeds working+procedural, defaults retrieval, skips working-memory grants, validates via `parseAgent`). Rationale fields are present on every module/grant and propagated. **5/5 tests pass.**

- **`apps/web` realizes the §4–§6 designer.** The full describe→infer→CRUD→run→export→save→share loop is wired against *real* `@coala/inference` and `@coala/runtime` packages (not stubs); `tsc --noEmit` exits 0 under Node 22. The literal PLAN §5 board surfaces exist (`board.tsx`: Memory cards, Access matrix, Grounding tray, Decision canvas, Advanced toggle), live `lintAgent` re-linting runs client-side, and "Why?" popovers quote the paper verbatim (`lib/coala-glossary.ts`). Diff-on-reinfer with Replace/Merge/Keep-mine (`lib/diff.ts`) realizes the §8 "never a silent overwrite" promise.

- **Export and runtime are real, not stubs.** Export emits neutral JSON/YAML/JSON-Schema plus 7-language runnable bundles with *working embedded runtimes* (Python and TS bundles were manually executed end-to-end). The runtime's `runTurn()` genuinely executes a retrieve→reason→act cycle with all five retrieval methods and real cosine-similarity embeddings, with access-policy-enforced writes and working MCP (stdio + streamable-HTTP, tested against a real subprocess).

---

## 4. Iterations, Corrections & Deviations

**Storage: Postgres + pgvector → SQLite (the dominant deviation).** PLAN §0/§6 specified Postgres + Prisma with pgvector reserved for Phase 2. The build uses **SQLite** (`prisma/schema.prisma` `provider = "sqlite"`), with the schema kept Postgres-portable (blueprint stored as JSON text) and an in-memory cosine `EmbeddingIndex` (`packages/runtime/src/embedding.ts`) standing in for pgvector — the code even carries an explicit "swap this for a pgvector" comment. *Why:* no Postgres on the build machine, and SQLite is the right zero-setup default for a local download. This is well-aligned with the (unstated) product goal — but pgvector is the single largest carried-forward gap, and **no durable persistence substrate was ever wired.**

**Auth: NextAuth/Auth.js → hand-rolled bcrypt sessions.** §6b only *suggested* Auth.js; the build hand-rolled email+password with bcrypt + DB-backed httpOnly sessions (`lib/auth.ts`). Functionally equivalent for v1, but lacks production hardening (rate-limiting, email verification, password reset).

**Phase ordering: Phase 2 pulled forward.** The plan framed the runtime + Run panel as a later bolt-on. They were built in the *same* delivery as Phase 1 — the "core-is-the-contract" design made it cheap. Good news, with one catch: the front-loaded runtime was built *without* a persistence layer, so the most important Phase 2 concern (durable memory) was the part that got skipped.

**Export: scope shifted wider and shallower.** Plan: TS stubs → LangGraph (JS+Python) → later LlamaIndex/OpenAI-tools. Built: TS + **LangGraph Python only** (no JS), *plus* a much larger, unplanned 7-language runnable-bundle system. LlamaIndex and generic OpenAI-tools adapters were dropped. The shift serves the "downloadable runnable agent" goal but leaves named §6a deliverables unbuilt.

**Scope added beyond plan.** Real cosine-embedding retrieval (initially a keyword stub, then corrected), MCP execution, deep memory editors (procedural skills, episodic rubric), three-way diff/merge, memory scaffolds, the destructive-tool linter rule, 22 verbatim-paper Why popovers, and an entire non-technical "Agent Workspace" UI layered over the original board (which became the "Expert view").

**Cosmetic/structural deviations (no functional impact):** DecisionProcedure sub-stages named `proposal/evaluation/selection` vs planned `propose/evaluate/select`; provider adapters collapsed openai/xai/ollama/local into one `OpenAICompatibleProvider`; diff/merge placed in the web layer rather than the inference package.

**Process note:** the repo had no version control until session 2 — the entire feature build is squashed into one initial commit, so the deviation narrative lives only in the handovers, not git history.

---

## 5. What Still Needs To Be Built

### Blocks the goal (must-have for v1)

1. **End-to-end memory persistence.** Net-new work: a memory-record store (new Prisma model *or* write-back into `Blueprint.agent.memoryModules[].records`), a write-back step in `/api/run` after `runTurn`, and a load step that seeds `AgentRuntime` stores from persisted records instead of the static blueprint seed. *Nothing of this exists today.*
2. **Cross-turn/session continuity.** Stop building a throwaway `AgentRuntime` per POST (`run/route.ts:49`); give each agent a durable store identity so consecutive turns and restarts share accumulated memory.
3. **Frictionless install for non-technical users.** A packaged artifact (Electron/Tauri desktop app or a one-click installer), a bundled Node runtime, auto-migrate-on-boot, and a guided first-run. None exist.
4. **In-app API-key entry.** BYO-key is `.env`-only with no UI affordance. A non-technical user cannot hand-edit a dotfile and restart a server. Needs a settings screen (keychain/encrypted-local storage) feeding the server side.
5. **Local single-user / no-auth mode.** Today every action requires register/login, and a manual `db:migrate`, before anything works — wrong for a personal local install.

### Nice to have (does not block the goal)

- Multi-candidate **Propose→Evaluate→Select** in the runtime (currently single propose→execute); honoring `decisionProcedure` styles at run time.
- **Learning modify/delete** write paths (schema models them; runtime only does `add`).
- **Version restore/rollback** and a version-diff endpoint (history is append+list only).
- Run panel as a **multi-turn chat** rather than single-turn.
- **Streaming** token output from the provider layer (UX).
- Fix **dead share edit-grant**; add share/invite **revocation**, rate-limiting, password reset.
- LangGraph **JS** adapter, LlamaIndex / OpenAI-tools adapters.
- **Automated bundle-execution tests** in CI (the `verified:true` flags are hand-set; C# is `verified:false`).

---

## 6. Critical Gaps for Shippability

The goal hinges on two things. Both are missing end-to-end.

### (a) Frictionless install for non-technical users — *entirely absent*

There is **no distribution layer of any kind** (confirmed by repo-wide search: zero Electron/Tauri/Docker/installer/standalone config outside built `.next/` bundles). The current path to a running app:

1. Install Node **≥18.17** — but `CLAUDE.md` itself flags the machine default is often 18.15 (too old), with no way for a layperson to diagnose the resulting error.
2. `npm install` at root, then `npm run build` **in strict dependency order** (core → providers → {inference,export,runtime} → web).
3. `cp apps/web/.env.example apps/web/.env`, then **hand-edit** to paste an API key.
4. `npm run -w @coala/web db:migrate` to create `dev.db` — *miss this and the app 500s on any DB call.*
5. `npm run -w @coala/web dev`, open `localhost:3000`.

Every step is a terminal command; there is **nothing to double-click**. The product exists only as source that must be compiled and served via a dev server. This is the largest single distance-to-goal item, and notably **PLAN.md never specified this goal at all** — the plan assumes a developer-run/hosted web app, so this gap is in the plan, not just the code.

### (b) Memory that genuinely persists & improves — *not delivered*

The decision cycle runs, but learned memory lives only in process RAM and is discarded after every HTTP request:

- `applyLearning()` calls `store.add()` on an `InMemoryStore` (`executor.ts:121-130`, `memory.ts:43-75`).
- That store is rebuilt fresh per request via `buildStores(agent)`, seeded **only** from the blueprint's static `m.records` (`memory.ts:78-86`).
- `/api/run` constructs `new AgentRuntime(...)`, returns the trace, and `close()`s it — **never writing anything back** (`run/route.ts:49-56`).
- The Prisma schema has **no `MemoryRecord` model**; `Blueprint.agent` is a single JSON blob with no run/memory tables.

Within a *single* turn, retrieve→write→retrieve works. Across turns or sessions, **everything learned is lost** — every message re-seeds from the static blueprint. Worse, the UI shows green "wrote to `<module>`" lines and help text claiming "memory writes are always real," which is **actively misleading** about the headline feature. Closing this requires real design (persistence model + write-back + seeded load + per-agent store identity), not configuration.

---

## 7. Recommended Path to a Shippable v1

An ordered sequence, front-loading the two goal-critical pillars before polish.

**Phase A — Make memory real (the value proposition).**
1. Add a persistence model for learned records — simplest: write `result.steps[].memoryWrite` back into `Blueprint.agent.memoryModules[].records` and PUT the updated blueprint after each `runTurn`; cleaner: a dedicated `MemoryRecord` Prisma model keyed by blueprint + module.
2. Seed `AgentRuntime` stores from persisted records (not just the static blueprint seed) on construction.
3. Give each agent a durable **store/session identity** so consecutive turns and process restarts share memory.
4. Implement learning **modify/delete** paths so episodic/semantic memory can be revised, not just appended.
5. Make the Run panel a **multi-turn chat** that demonstrates accumulation; only then is the UI's "writes are real" claim honest.

**Phase B — Make it installable by a non-technical user.**
6. Wrap the web app in a **desktop shell** (Tauri or Electron) with a bundled Node runtime — eliminates the Node-version trap and the dev-server requirement.
7. **Auto-migrate the SQLite DB on first boot** (or ship a seeded `dev.db`); remove the manual `db:migrate` step.
8. Add an **in-app settings screen for API keys** (stored encrypted / OS keychain, fed server-side) — kill the `.env` hand-edit.
9. Add a **local single-user mode** (auto-create or skip the account) so first run is "open → describe → use," not "register → login → migrate."
10. Produce a **signed installer** (.dmg/.exe) via a CI/release pipeline — the actual downloadable artifact.

**Phase C — Hardening & honesty.**
11. Add an **automated bundle-execution test** to CI so the 7-language `verified` flags are real (and fix/verify C#).
12. Add **version restore + diff** endpoints to deliver the "versioned and diffable" promise.
13. Close auth gaps relevant to a shared install: rate-limiting, share/invite revocation, password reset — or explicitly scope multi-tenant sharing *out* of the local v1 (much of it is inert on a purely local install anyway).
14. Optional depth: multi-candidate Propose→Evaluate→Select honoring `decisionProcedure`; provider streaming for run-panel UX.

**Bottom line:** Phases A and B are non-negotiable for the stated goal and represent the bulk of remaining effort. The foundation underneath them is excellent — the contract-first architecture means this work bolts on without rework — but until durable memory and a real installer exist, the product cannot meet its own headline promise.