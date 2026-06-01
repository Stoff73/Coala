# Session Handover — 2026-06-01 (CoALA Agent Builder)

- **Repo:** /Users/CSJ/Desktop/CoALA
- **Branch / VCS:** not a git repo (no version control configured)
- **Continues from:** none — first handover
- **Verification state (this session):** 70/70 package tests pass (core 23 · providers 12 · inference 5 · export 15 · runtime 15); web app typechecks + `next build` succeeds. Run web/build with Node ≥18.17 (default `node` here is 18.15 — use `export PATH="/usr/local/opt/node@22/bin:$PATH"`).

## 1. What was done this session
Built the **CoALA Agent Builder** from an empty repo to a working multi-package app (the whole arc described in `PLAN.md`), then extended well past the plan:
- **6 packages** (`@coala/core`, `providers`, `inference`, `export`, `runtime`, `apps/web`) — npm workspaces. `core`'s zod `Agent` document is the single contract everything consumes.
- **Designer**: describe → §6 three-pass inference → editable Blueprint Board with **live CoALA linting**; 6 Table-2 presets.
- **Accounts/persistence** (SQLite via Prisma, hand-rolled bcrypt auth + DB sessions), blueprint CRUD + linear version history + share links, **Workspaces + invite-by-email**.
- **Phase-2 runtime** + Run panel; **MCP / host-supplied tool execution** (stdio + HTTP), verified against a real stdio MCP server.
- **Runnable-agent export** in 7 languages (Python, TS, PHP, Go, Ruby, Java verified by execution; C# generated/preview) + **memory scaffolds** (`memory/` tree, episode rubric, procedural templates).
- **Diff-on-reinfer** (Merge/Replace/Keep-mine — edits no longer lost).
- **Real embedding retrieval** (cosine `EmbeddingIndex` + `EmbeddingProvider`: OpenAI or deterministic local) — closed the "embedding = keyword stub" gap.
- **Deep memory editing**: procedural (templates+skills), semantic (schema+records), episodic **rubric create/edit**; edits flow into the scaffold export.
- Added `CLAUDE.md` and this **session-handover skill** (`.claude/skills/session-handover/`).

## 2. What remains (known plan-vs-code gaps)
- **Postgres + pgvector storage backend** — retrieval *algorithm* is real cosine, but storage is SQLite + in-memory index (no Postgres here to verify). Interface (`EmbeddingIndex.rank`) already matches a pgvector query.
- **Auth.js / OAuth** — currently hand-rolled email+password (secure but not Auth.js); needs rate-limiting, email verification, password reset for prod.
- **"Why?" popovers quoting the paper** + full friendly↔technical vocabulary swap (only an Advanced toggle exists).
- **Destructive-digital-tool safety warning** in the linter (procedural-write + unlearning warnings exist).
- **MCP auto-wiring for Go/Ruby/PHP/Java/C# bundles** (only Python + TS auto-connect; others use the host-supplied registry).
- **C# bundle** is generated but not execution-verified (no `dotnet` on this machine).

## 3. Next steps (action list)
- [ ] If continuing the plan-match: wire a **Postgres + pgvector** store behind `EmbeddingIndex`/the Prisma layer (needs a running Postgres; switch `prisma/schema.prisma` provider + `DATABASE_URL`).
- [ ] Consider **git init** — this repo has no VCS, so there's no commit history; everything is working-tree only.
- [ ] Optionally finish the smaller UX gaps: paper-quote "Why?" popovers, destructive-tool linter warning.
- [ ] Extend MCP auto-wiring to the remaining bundle languages, or verify C# with a `dotnet` SDK.

## 4. Relevant files
| File | Why it matters |
|------|----------------|
| `PLAN.md` | The product/architecture plan; the "delta" between it and the code is discussed in chat (SQLite-vs-Postgres, hand-rolled-auth, two UX gaps). |
| `CLAUDE.md` | Toolchain gotchas (Node version, build order) + architecture for a fresh agent. |
| `packages/core/src/schema/*.ts` | The `Agent` zod model — the contract. `memory.ts` now has `procedural`/`rubric`; `action.ts` has `McpServer`. |
| `packages/runtime/src/embedding.ts` | Cosine `EmbeddingIndex` — **swap for a pgvector query here**; signature already matches. |
| `packages/runtime/src/mcp.ts` | MCP client + `buildTools`. |
| `packages/export/src/bundles/` | The 7 language emitters (runnable agents). `scaffold/memory.ts` = memory docs/rubric/templates. |
| `apps/web/components/board.tsx` | Blueprint Board — all the memory editors + Export bar + Run panel. |
| `apps/web/lib/diff.ts` | diff-on-reinfer merge logic (preserves edits). |
| `apps/web/app/api/run/route.ts` | Wires runtime + MCP + embedder server-side. |

## 5. Load these into context first (read order)
1. `june/june01/handover-session-1.md` — this handover (the situation as of now).
2. `CLAUDE.md` — build/test commands + Node-version gotcha + architecture.
3. `PLAN.md` — original plan; needed to reason about remaining plan-vs-code gaps.
4. `README.md` — current status + per-package summary + how to run.
5. `packages/core/src/schema/agent.ts` (+ `memory.ts`, `action.ts`) — the domain model every package depends on.

## Notes / gotchas
- **Node:** default `node` is 18.15 (too old for Next 14). Use `node@22` (`/usr/local/opt/node@22/bin`) or `nvm use 20` for `apps/web` and full builds. nvm default is set to 20.
- **Build order matters:** `core → providers → {inference, export, runtime} → apps/web` (cross-package imports resolve through built `dist/`). Rebuild packages before typechecking the web app.
- **DB:** SQLite at `apps/web/prisma/dev.db` (gitignored-style; reset with `npx prisma migrate reset` from `apps/web`, using Node ≥18.17). Test data is cleared.
- **Verification norm here is execution, not just compilation** — exported agents (incl. a real stdio MCP subprocess) were run end-to-end, not only typechecked.
- **No git** — there is no commit history; consider `git init` if you want one.
