---
type: handover
mode: end-of-day
date: 2026-06-03
session: 1
branch: feat/file-based-memory-tree
previous_session: 2026-06-02 session-1 (june/june02/handover-session-1.md)
---

# Handover — 2026-06-03, Session 1 (end of day)

## Where we left off
Shipped **Phase A: the file-based memory engine** as **PR #4** (https://github.com/Stoff73/Coala/pull/4),
branch `feat/file-based-memory-tree`, 25 commits ahead of `main`, **not yet merged**. A CoALA agent is
now a portable markdown/YAML folder whose learning persists to disk and survives restarts. The branch is
green (133 tests) and the PR is open for review. Next working session should either merge PR #4 or start
the **sequel plan** (web local-mode adoption).

## What this session produced (the arc)
This session ran the full **brainstorm → spec → plan → build → review → ship** cycle:
1. **Delta report** (`DELTA-REPORT.md`, repo root, still UNTRACKED until this handover's commit) — a
   multi-agent workflow comparing `PLAN.md` to what's built. Verdict: strong dev tool, but the two
   things the product *goal* hinges on were unbuilt — frictionless install and memory-that-persists.
2. **Design spec** — `docs/superpowers/specs/2026-06-03-file-based-memory-tree-design.md`.
3. **Implementation plan** — `docs/superpowers/plans/2026-06-03-file-based-memory-engine.md` (14 TDD tasks).
4. **Built it** via subagent-driven development: fresh implementer per task + two-stage (spec + quality)
   review + fix loops. Tasks 10+11 were merged (too coupled to land independently green).

## What shipped today (commits)
- `feat(core)`: **Store interface** + Pointer/RecordMeta/Record_/RetrievalQuery types (async contract in core, breaks the dep cycle).
- New **`@coala/agent-fs`** package: frontmatter I/O (CRLF-tolerant), path slug + traversal guard, `reindexModule`, **`FileStore`** (lean `_index.md`, lazy bodies, atomic write-back), `saveAgentFolder`/`loadAgentFolder` (six-preset round-trip + master index), `resolveSkill` (template/reference/script — **execution deferred**), `buildFileStores`.
- `@coala/runtime`: **async Store** + `InMemoryStore implements Store`; **injectable stores** on `AgentRuntime`; **`memory.open`** tool; **post-turn episodic capture** (rubric-scored reflection, best-effort, surfaced in `TurnResult`); embedding ranks pointer summaries then lazily opens winners.
- **Money test** (`packages/agent-fs/src/__tests__/persistence.integration.test.ts`): a learning write lands as a file on disk, survives a simulated restart, and is retrievable next session.

## What's in flight (NOT done)
- **PR #4 is open, not merged.** Awaiting review/merge decision.
- **DELTA-REPORT.md** is committed on this branch as of this handover (was untracked).
- Phase A is "Plan 1 of 2" — the **sequel plan is not yet written**.

## Deploy status
Nothing to deploy — this is a TS monorepo library/runtime change, no hosting target. `apps/web` still
builds (verified under Node 22) but was not modified.

## Tech debt found this session (deferred, from code reviews)
- **Duplicated `tokens()` helper** across `packages/agent-fs/src/file-store.ts` and `packages/runtime/src/memory.ts` — left duplicated deliberately (2 lines, different shapes; hoisting to core would pull a ranking concern into the pure-contract package). Revisit only if it grows.
- **Master `memory/index.md` is written but not yet read into the LLM context** each cycle — deferred by design to the sequel (runtime context-builder concern). Today it's disk decoration, not a live cost-tier-0 source.
- `InMemoryStore.openBody("")` returns `records[0]` (`Number("")===0`); harmless (no caller passes ""), test-double only.
- `InMemoryStore` ranks `importance` from `record.importance` (in `data`) while `FileStore` ranks from index `meta.importance` (frontmatter) — a quiet semantic divergence between backends; worth a comment someday.

## Known issues / blockers
None. Branch is green: builds + typechecks clean; **133 tests** pass (core 36, providers 12, inference 5, runtime 23, export 15, agent-fs 42).

## Rules / decisions reinforced this session
- **Architecture pivot:** "files for everything" — the agent folder is the source of truth, SQLite is no longer the persistence backbone (user decision during brainstorming).
- **Skill script execution is deferred** (security-scoped follow-on) — resolved + surfaced only this round.
- **App shape:** "keep auth, bypass in local mode" (implicit single user, skip login) — for the sequel.
- Memory saved at `~/.claude/projects/-Users-CSJ-Desktop-CoALA/memory/phase-a-file-memory-engine.md` (+ `MEMORY.md` index) capturing the pivot + the full pending roadmap.
- Toolchain gotcha that bit mid-build: `noUncheckedIndexedAccess` is on → `regex.exec()[1]` needs `?? ""` or `tsc` fails (vitest/esbuild won't catch it).

## Next session should
1. **Decide PR #4:** merge to `main` (it's green and reviewed by the multi-agent flow) or request human review first.
2. **Write the sequel plan** `docs/superpowers/plans/2026-06-03-web-local-mode-adoption.md` covering, in order:
   - `/api/run` loads an agent folder, injects `buildFileStores`, persists writes (read `apps/web/app/api/run/route.ts` — it currently constructs `new AgentRuntime(...)` and discards it).
   - Load master `memory/index.md` into the LLM context each cycle (wire into `packages/runtime/src/prompt.ts` `reasonRequest`).
   - Local-mode auth bypass (auto single user, skip login).
   - One-time SQLite `Blueprint` → agent-folder migration.
   - Multi-turn chat Run panel to surface accumulating memory.
3. **Then Phase B (installability)** from the delta report: Tauri/Electron wrapper + bundled Node, auto-migrate on boot, in-app API-key entry, signed installer.

## Context hints
- Active branch: `feat/file-based-memory-tree` (feature; PR #4 open against `main`).
- Ahead of `origin/main` by: 25 commits (all pushed to the feature branch).
- Uncommitted: none after this handover's commit (a transient `.claude/scheduled_tasks.lock` is left untracked — harness artifact, do not commit).
- Last code commit: `596ac59 fix(agent-fs): seed records use slug as id so FileStore can open them`.
- Build order reminder: `core → providers → {runtime, agent-fs} → apps/web`. agent-fs depends on core (+ runtime/providers as devDeps for the integration test).
