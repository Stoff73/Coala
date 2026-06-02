# Session Handover — 2026-06-02

- **Repo:** /Users/CSJ/Desktop/CoALA
- **Branch / VCS:** `main` (clean working tree). A **GitHub remote now exists**: `origin` → https://github.com/Stoff73/Coala (public). `main` tip `bc493d4`.
- **Continues from:** `june/june01/handover-session-2.md` (which ended at: app built, git initialized, no remote, several plan-vs-code gaps open).
- **Verification state (this session, actually run):** On merged `main` — **81/81 package tests pass** (core 34, export 15, inference 5, providers 12, runtime 15) and **`npm run -w @coala/web build` exits 0** (Node 22). Both features were also **browser-verified live** via Playwright (System Map default, node navigation, memory deep-link, holistic health propagation, Act/Perceive lens move, Export screen). Not re-run after the final branch cleanup, but nothing changed post-build.

## 1. What was done this session
Shipped **two full features** end-to-end (brainstorm → spec → plan → subagent-driven build with spec+quality review per task → verification → PR → merge), and set up the GitHub remote.

- **Feature A — Destructive-tool linter warning + "Why?" popovers** (merged via **PR #1**):
  - Added optional `sideEffect: "read"|"write"|"destructive"` to `DigitalTool` (`packages/core/src/schema/{common,action}.ts`).
  - New linter rule `destructiveToolSafety` in `packages/core/src/invariants/lint.ts` — warns (never errors) when a tool is declared destructive OR (untagged) its name/description matches a destructive-verb heuristic. **Heuristic is camelCase-aware** (splits on uppercase before matching; `deleteRecord` matches).
  - Board: a side-effect `<select>` per digital tool. Presets regression test asserts none trip the heuristic.
  - "Why?" popovers: `apps/web/lib/coala-glossary.ts` (22 **verbatim** quotes from `2309.02427v3.pdf`) + `apps/web/components/why.tsx` (`<Why id>` popover, accessible) wired across the board (sections, memory kinds, retrieval, learning, grounding types, decision stages).
- **Feature B — Agent Workspace UI** (merged via **PR #3**; PR #2 was an auto-closed casualty — see gotchas):
  - New non-technical interface that is now the **default** after generate/load; the old dense board is the **"Expert view"** drill-down.
  - `apps/web/components/workspace/`: `agent-workspace.tsx` (in-page screen router over one shared `Agent`), `system-map.tsx` (Perceive→Memory→Decide→Act loop + plain-language health banner + per-node status dots + clickable memory chips), `screen-frame.tsx`, and detail screens `memory-screen.tsx` (sibling-switcher + plain "the agent can…" access), `perceive-screen.tsx` / `act-screen.tsx` (grounding filtered by direction via `sideEffect`), `decision-screen.tsx`, `test-screen.tsx`, `export-screen.tsx`.
  - `apps/web/lib/health.ts` — `summarizeHealth(agent)` maps `lintAgent` findings → plain-language banner + per-concern dots.
  - Board refactors (behavior-preserving, verified): extracted `ModuleEditor` from `MemorySection`; `BlueprintBoard` accepts parent-owned `agent`/`update`; added a `lens` prop to `GroundingSection` and a shared `applyGrant` helper in `apps/web/lib/blueprint-edit.ts`.
  - Applied 4 reviewer-flagged polish fixes (commit `0fa0a22`): no-grounding lights both Perceive+Act dots; memory deep-link `useEffect` re-sync; status-dot `aria-label`; blurb spacing.
- **VCS:** created public GitHub repo `Stoff73/Coala`, pushed `main`, merged both PRs into `main`. Needed `git config http.postBuffer 524288000` to push past an HTTP 400 (the 2.7 MB PDF).

## 2. What remains
Plan-vs-code gaps carried forward from session-1/2 (still open — none touched this session):
- **Postgres + pgvector storage backend** — retrieval algorithm is real cosine (`packages/runtime/src/embedding.ts`), but storage is SQLite + in-memory. Biggest plan gap; user previously flagged interest. Needs a running Postgres (none on this machine).
- **Auth.js / OAuth** — auth is hand-rolled email+password; prod needs rate-limiting, email verification, password reset.
- **MCP auto-wiring for Go/Ruby/PHP/Java/C# bundles** (only Python + TS today); C# bundle unverified (no `dotnet`).
- Minor, non-blocking, noted in PR #3: the `perceive` health dot still has no dedicated lint *invariant* (only lights via the shared no-grounding error); `MemoryScreen` deep-link select is correct today because navigation remounts.

## 3. Next steps (action list)
> Pick by user intent; nothing is blocking. The two features just shipped are complete.
- [ ] If continuing the plan-match work: wire a **Postgres + pgvector store behind `EmbeddingIndex`** (`packages/runtime/src/embedding.ts` — signature already matches) + switch Prisma `provider`/`DATABASE_URL`. Needs a running Postgres.
- [ ] Optional UX next layer: the workspace currently has no in-app way to **add a new memory system / grounding interface from the map** (you add modules via the Expert view or the memory screen's underlying editor). Consider a "+ add" affordance on the map.
- [ ] If re-touching packages: re-run `npm test` (use `export PATH="/usr/local/opt/node@22/bin:$PATH"`) to re-confirm 81/81.
- [ ] **Stacked-PR gotcha for next time:** merge the base PR **without** `--delete-branch`, let GitHub auto-retarget the child PR, then delete the old branch. Using `--delete-branch` on the base PR this session *closed* the dependent PR (#2) instead of retargeting it.

## 4. Relevant files
| File | Why it matters |
|------|----------------|
| `apps/web/components/workspace/agent-workspace.tsx` | The new default UI's screen router; entry point for any workspace change. |
| `apps/web/components/workspace/system-map.tsx` | The overview map (loop + health banner + dots). |
| `apps/web/lib/health.ts` | `summarizeHealth` — findings → plain language + per-concern dots; edit here to change health framing. |
| `apps/web/components/board.tsx` | The Expert view; now also exports `ModuleEditor`/`GroundingSection`(+`lens`)/`DecisionSection`/`ExportBar`/`Update` reused by the screens. |
| `apps/web/lib/blueprint-edit.ts` | `applyGrant` (shared access-grant mutation) + `newModule`/`newGrounding`/`emptyGrant`. |
| `packages/core/src/invariants/lint.ts` | The linter incl. `destructiveToolSafety`; **swap point for any new invariant** (e.g. a real Perceive invariant). |
| `packages/core/src/schema/{common,action}.ts` | The `Agent` zod model; `SideEffect` + `DigitalTool.sideEffect` live here. |
| `apps/web/lib/coala-glossary.ts` | The 22 verbatim paper quotes behind `<Why>`. |
| `packages/runtime/src/embedding.ts` | Cosine `EmbeddingIndex` — the pgvector swap point (next-steps item 1). |
| `docs/superpowers/specs/2026-06-02-agent-workspace-design.md` | Design rationale for the workspace (decisions: 4-node map, two-column screens, etc.). |

## 5. Load these into context first (read order)
1. `june/june02/handover-session-1.md` — this handover (current state).
2. `CLAUDE.md` — build/test commands, Node-version gotcha, architecture, session-continuity rules.
3. `docs/superpowers/specs/2026-06-02-agent-workspace-design.md` — the workspace design (the most recent feature; explains the screen model).
4. `docs/superpowers/specs/2026-06-02-coala-ux-gaps-design.md` — the linter/popover feature design.
5. `june/june01/handover-session-2.md` — prior session (full feature-build history of the app itself + the still-open plan gaps).
6. `PLAN.md` — original product/architecture plan (for the pgvector/auth gap analysis).

## Notes / gotchas
- **Node:** default `node` is 18.15 (too old for Next 14). Use `node@22` (`export PATH="/usr/local/opt/node@22/bin:$PATH"`) for `apps/web` + full builds. Build order: `core → providers → {inference, export, runtime} → apps/web`.
- **GitHub remote is new this session** and **public**. `git config http.postBuffer 524288000` is set locally (needed for the large initial push). Branches `feat/coala-ux-gaps` and `feat/agent-workspace` are merged and deleted (local + remote).
- **Stacked PRs:** PR #2 (workspace) was auto-closed when its base branch `feat/coala-ux-gaps` was deleted on PR #1 merge; recreated as **PR #3** and merged. History is intact; just don't be confused that the workspace PR is #3, not #2. (Mitigation in next-steps.)
- **Verification philosophy (CLAUDE.md):** this repo expects *execution, not just compilation* — `apps/web` has **no component test runner**, so web work is verified by `tsc --noEmit` + `next build` + a real browser walkthrough (Playwright was used this session).
- **The workspace is a thin shell over reused editors** — the four CoALA concerns are the *same* board editors, re-parented; `lintAgent` and the `Agent` object are unchanged. Don't reimplement editing logic in the screens; reuse the exports from `board.tsx`.
- **`.superpowers/`** (brainstorm visual-companion mockups) and the existing `.remember/` are gitignored.
