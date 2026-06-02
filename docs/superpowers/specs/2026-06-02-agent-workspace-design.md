# Design — Agent Workspace: a clean overview-and-drill-down interface for non-technical users

**Date:** 2026-06-02
**Status:** Approved (design); pending spec review → implementation plan
**Depends on:** the `Why` paper-quote popover and the `DigitalTool.sideEffect` field from
`feat/coala-ux-gaps` (PR #1). This work branches off that tip (`feat/agent-workspace`).

## Goal

Layer a clean, non-technical interface on top of the existing CoALA Blueprint Board. Users land on a
holistic **System Map** of their agent and click any part to open a focused, plain-language detail
screen for that one concern — dealing with each memory system (and each other part) on its own, while
always being able to see the whole system. The existing dense board is retained as an "Expert view"
drill-down, not the default.

## Background

Today `apps/web/app/page.tsx` renders, after generate/load, a single `<BlueprintBoard>`
(`apps/web/components/board.tsx`, ~879 lines): one long-scroll page stacking Findings, Memory, Access,
Grounding + Decision, Run, Export, and an optional raw-JSON view, with an "Advanced" toggle. It edits
one in-memory `Agent` object and re-lints live (`lintAgent` in a `useMemo`). This is powerful but dense
for non-technical users.

The board's section editors (`MemorySection`, `AccessSection`, `GroundingSection`, `DecisionSection`),
`RunPanel`, `ExportBar`, and `Why` already work and lint live. This design **wraps** them in a calmer
navigation shell rather than rewriting them.

## Decisions (locked during brainstorming)

1. **Relationship to the board:** the clean overview becomes the **new default**; the existing board
   becomes a reachable **"Expert view"** drill-down.
2. **Overview style:** a **System Map** — the agent drawn as a loop (Perceive → Memory → Decide →
   Act), with a health banner and the four memory systems visible as chips. (Not a tiled dashboard.)
3. **Detail-screen layout:** **explanation beside the controls** — two columns, plain-language
   explanation on the left, the real editor on the right, nothing hidden behind a toggle.
4. **Screen set:** **four clickable nodes** — Perceive · Memory · Decision · Act. Perceive and Act are
   two **filtered views over the same grounding data** (by direction).

## Architecture

A new top-level **`AgentWorkspace`** component replaces the direct `<BlueprintBoard>` render in
`page.tsx`. It is an in-page "screen router": one piece of state, `screen`, over the **single edited
`Agent` object**. No new persistence and no URL routing — this preserves the current
Save/Share-on-change flow and the "the diagram IS the data" principle. Moving between screens never
loses edits because all screens read/write the same in-memory `Agent`.

```
AgentWorkspace (owns: agent state, update fn, screen state, live lint result)
├── SystemMap                 screen="map"      (default landing)
├── MemoryScreen              screen="memory"
├── PerceiveScreen            screen="perceive"
├── ActScreen                 screen="act"
├── DecisionScreen            screen="decision"
├── TestScreen                screen="test"     (wraps existing RunPanel)
├── ExportScreen              screen="export"   (wraps existing ExportBar)
└── ExpertView                screen="board"    (renders existing BlueprintBoard)
```

`AgentWorkspace` lifts the `agent`/`update`/`onChange` ownership that `BlueprintBoard` currently holds,
so both the new screens and the Expert view operate on the same object. `BlueprintBoard` is refactored
to optionally accept `agent`/`update` from a parent (falling back to its own state when used
standalone), so the Expert view shares state with the workspace.

### Navigation

- The map is the landing screen. Each node is a button that sets `screen`.
- Each detail screen has a breadcrumb back to the map (e.g. "← Overview · Memory").
- An "Expert view" link (in the workspace header) opens `screen="board"`.
- Test and Export are reachable from the map (small entries below the loop).

## Components

### `SystemMap` (new) — `screen="map"`
The holistic overview. Renders:
- **Header:** agent name (editable inline), goals, provider chip — the same controls the board header
  has today, lifted up.
- **Health banner:** a plain-language summary derived from `lintAgent(agent)` (see Holistic
  Evaluation). Green "✓ Ready to test" when no findings; otherwise a short friendly list.
- **The loop:** four clickable nodes — 👂 Perceive → 🧠 Memory → ⚖️ Decide → 🤚 Act — drawn as a
  cycle, with a "↺ repeats each turn" caption. The Memory node shows the four memory systems as chips
  (Working · Episodic · Semantic · Procedural→"Code"); clicking a chip deep-links into MemoryScreen on
  that system, clicking the node body opens MemoryScreen on the first system.
- Each node carries a **status dot** (see Holistic Evaluation) and a one-line summary
  (e.g. Memory: "4 systems · 1 holds your catalog").
- Below the loop: small **Test it** and **Export** entries, and an **Expert view** link.

### Detail screens (new thin wrappers) — two-column: explanation (left) + editor (right)

- **`MemoryScreen`** (`screen="memory"`, optional `focusModuleId`): a **sibling-switcher** across the
  agent's memory modules (Working · Episodic · Semantic · Code). Shows **one module at a time**:
  - Left: plain-language "what this is / why it's here" for the module's `kind`, with the `<Why>`
    popover keyed to that kind.
  - Right: the existing per-module editor (reused from `MemorySection`) for that single module, **plus**
    the **access** controls for that module (read / add / change / remove) phrased plainly ("The agent
    can…"). This folds the current Access matrix row into the memory system it belongs to.
  - To keep edits identical to today, the per-module editor body is factored out of `MemorySection`
    into a reusable `ModuleEditor` so both `MemorySection` (board) and `MemoryScreen` use the same code.
- **`PerceiveScreen`** (`screen="perceive"`): grounding framed as "how the world reaches your agent."
  Left: explanation. Right: the grounding interfaces relevant to input — **dialogue** + **physical**
  interfaces, plus **digital tools whose `sideEffect === "read"`** — using the existing grounding
  editor, filtered.
- **`ActScreen`** (`screen="act"`): grounding framed as "what your agent can do." Right: **dialogue** +
  **physical** interfaces, plus **digital tools whose `sideEffect !== "read"`** (write / destructive /
  untagged). Destructive tools surface the `destructive-tool-safety` warning already implemented.
- **`DecisionScreen`** (`screen="decision"`): left explanation of propose / evaluate / select (with
  `<Why>`); right the existing `DecisionSection` editor.

### `TestScreen` / `ExportScreen` (new thin wrappers)
Each is a breadcrumb + a short explanation + the existing `RunPanel` / `ExportBar`, unchanged.

### `ExpertView` (`screen="board"`)
Renders the existing `BlueprintBoard` (now parented), giving power users the all-in-one dense view.

## Perceive / Act grounding filter

Both screens edit the same `agent.groundingInterfaces`; they differ only in what they surface:

| Interface / tool | Perceive | Act |
|---|---|---|
| `dialogue` interface | ✓ ("receives messages") | ✓ ("sends replies") |
| `physical` interface | ✓ ("senses") | ✓ ("actuates") |
| `digital` tool, `sideEffect === "read"` | ✓ | — |
| `digital` tool, `sideEffect !== "read"` (write/destructive/unset) | — | ✓ |

Dialogue and physical interfaces are intentionally shown on both screens (they are inherently
bidirectional); editing on either screen mutates the same interface. A short note on each screen
explains this so it doesn't read as duplication. Digital tools are partitioned by `sideEffect`, reusing
the field added in PR #1. Editing a tool's side-effect on one screen can move it to the other — that is
expected and acceptable.

## Holistic evaluation (findings → plain language)

A new pure helper, **`summarizeHealth(agent): HealthSummary`** (in `apps/web/lib/health.ts`), runs
`lintAgent(agent)` and maps the `Finding[]` into:
- an overall status (`ok` / `attention`) + a friendly headline ("✓ Ready to test" / "1 thing to
  check"),
- a list of plain-language items (each finding's `message` is already plain-ish; the helper supplies a
  short friendlier lead-in per `rule` where useful, falling back to the raw message),
- a per-concern dot: each finding's `path` (e.g. `memoryModules…`, `groundingInterfaces…`,
  `accessPolicy…`, `decisionProcedure…`) maps to a node (`memory` / `perceive`+`act` / `decision`) so
  the map can show which areas need attention.

No linter logic changes — this is a presentation layer over the findings already computed. The Expert
view keeps showing the full raw `Findings` list unchanged.

## Files

- **New:**
  - `apps/web/components/workspace/agent-workspace.tsx` — the screen router + lifted state.
  - `apps/web/components/workspace/system-map.tsx` — the overview map + health banner.
  - `apps/web/components/workspace/memory-screen.tsx`, `perceive-screen.tsx`, `act-screen.tsx`,
    `decision-screen.tsx`, `test-screen.tsx`, `export-screen.tsx` — detail-screen wrappers.
  - `apps/web/lib/health.ts` — `summarizeHealth` + types.
- **Modified:**
  - `apps/web/app/page.tsx` — render `<AgentWorkspace>` instead of `<BlueprintBoard>` after
    generate/load.
  - `apps/web/components/board.tsx` — extract `ModuleEditor` from `MemorySection` (no behavior change);
    make `BlueprintBoard` accept optional parent-owned `agent`/`update` (fall back to own state). Export
    the section editors / `ModuleEditor` and the grounding-filter so screens can reuse them.
- **Reused unchanged:** `@coala/core` (`Agent`, `lintAgent`), `RunPanel`, `ExportBar`, `Why`,
  `DigitalTool.sideEffect`.

## Verification

- **Typecheck/build:** `npm run -w @coala/web typecheck` and `npm run -w @coala/web build` green
  (Node ≥18.17 via `node@22`).
- **No regression to the board:** the existing board still renders and edits (now as Expert view); the
  refactor of `ModuleEditor` and parented state changes no behavior.
- **Browser walkthrough (execution, per CLAUDE.md):** load a preset → map renders with health banner
  and four nodes → click each node into its screen → switch memory siblings → edit a field and confirm
  the map/health updates on return → open Expert view → confirm a `destructive`-tagged tool appears
  under **Act** with its warning and a `read`-tagged tool appears under **Perceive**.

## Out of scope (YAGNI)

- URL routing / deep links per screen (in-page state only).
- Persisting which screen the user was on.
- Animated map transitions; any restyle of the existing editors beyond placing them in the two-column
  shell.
- Changes to inference, export, runtime, or the linter rules.

## Build order

1. `summarizeHealth` helper + `AgentWorkspace` shell rendering the System Map and routing to a stub
   for each screen (map works end-to-end first).
2. Refactor `ModuleEditor` out of `MemorySection`; parent-owned state on `BlueprintBoard`; Expert view.
3. `MemoryScreen` (sibling switcher + ModuleEditor + plain access).
4. `PerceiveScreen` / `ActScreen` (grounding filter) and `DecisionScreen`.
5. `TestScreen` / `ExportScreen` wrappers; wire `page.tsx`.
6. Full verification pass (typecheck, build, browser walkthrough).
