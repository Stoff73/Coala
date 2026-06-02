# Agent Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a clean, non-technical "Agent Workspace" — a System Map overview that drills into focused per-concern detail screens — layered over the existing Blueprint Board (kept as an Expert view).

**Architecture:** A new in-page screen router (`AgentWorkspace`) owns one `Agent` object and a `screen` enum. It renders a `SystemMap` (default) and thin detail-screen wrappers that reuse the existing, already-linting board editors (`ModuleEditor`, `GroundingSection`, `DecisionSection`, `RunPanel`, `ExportBar`) plus the `Why` popover. No new persistence, no URL routing — the single `Agent` is the source of truth across all screens.

**Tech Stack:** Next.js 14 (App Router) + React + Tailwind, `@coala/core` (zod model + `lintAgent`). Node ≥18.17 — prefix web commands with `export PATH="/usr/local/opt/node@22/bin:$PATH"`. `apps/web` has **no component test runner** (only `typecheck` + `build`), so web tasks verify via `tsc --noEmit` and a final browser walkthrough — consistent with how the prior web feature was verified.

**Reference docs:** spec at `docs/superpowers/specs/2026-06-02-agent-workspace-design.md`. Key existing files: `apps/web/components/board.tsx`, `apps/web/components/why.tsx`, `apps/web/components/run-panel.tsx`, `apps/web/lib/blueprint-edit.ts`, `apps/web/lib/types.ts`, `apps/web/app/page.tsx`.

**Branch:** `feat/agent-workspace` (already created off the `feat/coala-ux-gaps` tip — this work depends on the `Why` component and `DigitalTool.sideEffect`).

**Verification command (every web task):**
`export PATH="/usr/local/opt/node@22/bin:$PATH" && npm run -w @coala/web typecheck` → expect no output (exit 0).

---

## Task 1: Health summary helper

**Files:**
- Create: `apps/web/lib/health.ts`

- [ ] **Step 1: Create the helper**

```ts
import { lintAgent } from "@coala/core";
import type { Agent, Finding, Severity } from "@coala/core";

/** A board concern a finding can be attributed to (drives the map's status dots). */
export type Concern = "memory" | "perceive" | "act" | "decision";

export interface HealthItem {
  message: string;
  severity: Severity;
  concern: Concern | null;
}

export interface HealthSummary {
  status: "ok" | "attention"; // attention = has at least one error (blocks validity)
  headline: string;
  items: HealthItem[];
  byConcern: Record<Concern, boolean>; // true = some finding (error or warning) touches this concern
}

/** Map a finding's dotted `path` to the concern screen it belongs to. */
function concernForPath(path: string | undefined): Concern | null {
  if (!path) return null;
  if (path.startsWith("memoryModules") || path.startsWith("accessPolicy")) return "memory";
  if (path.startsWith("groundingInterfaces")) return "act";
  if (path.startsWith("decisionProcedure")) return "decision";
  return null;
}

/** Translate lint findings into a plain-language health summary for the System Map. */
export function summarizeHealth(agent: Agent): HealthSummary {
  const items: HealthItem[] = lintAgent(agent).findings.map((f: Finding) => ({
    message: f.message,
    severity: f.severity,
    concern: concernForPath(f.path),
  }));

  const errors = items.filter((i) => i.severity === "error").length;
  const warnings = items.filter((i) => i.severity === "warning").length;

  const byConcern: Record<Concern, boolean> = { memory: false, perceive: false, act: false, decision: false };
  for (const i of items) if (i.concern) byConcern[i.concern] = true;

  const status: "ok" | "attention" = errors > 0 ? "attention" : "ok";
  const headline =
    errors > 0
      ? `${errors} thing${errors > 1 ? "s" : ""} to fix before this agent is valid`
      : warnings > 0
        ? `Ready to test · ${warnings} thing${warnings > 1 ? "s" : ""} to check`
        : "Ready to test";

  return { status, headline, items, byConcern };
}
```

- [ ] **Step 2: Typecheck**

Run: `export PATH="/usr/local/opt/node@22/bin:$PATH" && npm run -w @coala/web typecheck`
Expected: PASS (exit 0). (`Finding`/`Severity` are exported from `@coala/core` via `invariants/lint.ts`.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/health.ts
git commit -m "feat(web): summarizeHealth — findings to plain-language summary"
```

---

## Task 2: Board refactor — export reusables + extract ModuleEditor

This is a **behavior-preserving** refactor of `apps/web/components/board.tsx` so screens can reuse its editors. No visual/logic change.

**Files:**
- Modify: `apps/web/components/board.tsx`

- [ ] **Step 1: Export the `Update` type**

In `apps/web/components/board.tsx`, find the line (near line 29):
```tsx
type Update = (fn: (draft: Agent) => void) => void;
```
Change it to:
```tsx
export type Update = (fn: (draft: Agent) => void) => void;
```

- [ ] **Step 2: Extract `ModuleEditor` from `MemorySection`**

`MemorySection` currently maps `agent.memoryModules` and renders each module's editor inline. Replace the whole `MemorySection` function (it begins at `function MemorySection({ agent, update, advanced }: ...)` around line 166 and ends at its closing `}` before `function ProceduralEditor`) with the two functions below. The **per-module JSX body is unchanged** — it is the exact `<div key={m.id} className={...}>…</div>` currently returned inside the `.map((m, idx) => { … })`, moved verbatim into `ModuleEditor`, with `m` and `meta` now derived from `agent`/`idx`.

```tsx
function MemorySection({ agent, update, advanced }: { agent: Agent; update: Update; advanced: boolean }) {
  return (
    <Section
      title="Memory modules"
      hint="Working + procedural are always present; add episodic & semantic as needed."
      whyId="memory"
      action={
        <div className="flex gap-1">
          {MemoryKind.options.map((k) => (
            <IconBtn key={k} title={`Add ${k}`} onClick={() => update((d) => d.memoryModules.push(newModule(k)))}>
              + {k}
            </IconBtn>
          ))}
        </div>
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
        {agent.memoryModules.map((m, idx) => (
          <ModuleEditor key={m.id} agent={agent} idx={idx} update={update} advanced={advanced} />
        ))}
      </div>
    </Section>
  );
}

/** Editor for a single memory module. Reused by the board (MemorySection) and the Memory screen. */
export function ModuleEditor({ agent, idx, update, advanced }: { agent: Agent; idx: number; update: Update; advanced: boolean }) {
  const m = agent.memoryModules[idx]!;
  const meta = MEMORY_KIND_META[m.kind];
  return (
    /* MOVE VERBATIM: the existing per-module <div key={m.id} className={`rounded-xl border p-4 ${meta.cls}`}> … </div>
       block that was the body of the old MemorySection's .map((m, idx) => { return ( … ) }).
       It already references m, idx, meta, update, advanced, Why, Select, Input, Area, IconBtn,
       MemoryKind, BackingStoreType, FieldType, RetrievalMethod, ProceduralEditor, RubricEditor —
       all still in scope. Do NOT change its contents. Remove the `key={m.id}` (the parent map now
       supplies the key); keep the className using meta.cls. */
    <div className={`rounded-xl border p-4 ${meta.cls}`}>
      {/* … unchanged module-editor JSX … */}
    </div>
  );
}
```

Note: `Section` already supports the `whyId` prop (added in the prior feature), so `whyId="memory"` is valid.

- [ ] **Step 3: Export `GroundingSection`, `DecisionSection`, `ExportBar`**

Add `export` to each of these existing declarations in `board.tsx`:
- `function GroundingSection(` → `export function GroundingSection(`
- `function DecisionSection(` → `export function DecisionSection(`
- `function ExportBar(` → `export function ExportBar(`

(Leave `AccessSection`, `MemorySection`, `ProceduralEditor`, `RubricEditor`, `Findings`, and the small input primitives un-exported — screens don't need them.)

- [ ] **Step 4: Typecheck**

Run: `export PATH="/usr/local/opt/node@22/bin:$PATH" && npm run -w @coala/web typecheck`
Expected: PASS. If it fails, the most likely cause is the moved JSX referencing something now out of scope — confirm the body was moved verbatim and `m`/`meta` are derived at the top of `ModuleEditor`.

- [ ] **Step 5: Visual sanity (board unchanged)**

Start dev (`export PATH="/usr/local/opt/node@22/bin:$PATH" && npm run -w @coala/web dev`), load a preset, confirm the Memory section renders and edits exactly as before. Stop the server.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/board.tsx
git commit -m "refactor(web): extract ModuleEditor; export board editors for reuse"
```

---

## Task 3: Parented BlueprintBoard (shared state)

Let `BlueprintBoard` optionally use parent-owned `agent`/`update` so the Expert view shares the workspace's `Agent`. Backward-compatible (falls back to its own state).

**Files:**
- Modify: `apps/web/components/board.tsx` (the `BlueprintBoard` function, ~line 792)

- [ ] **Step 1: Replace the signature + state head**

The function currently begins:
```tsx
export function BlueprintBoard({
  result,
  onChange,
}: {
  result: BlueprintResult;
  onChange?: (agent: Agent) => void;
}) {
  const [agent, setAgent] = useState<Agent>(result.agent);
  const [advanced, setAdvanced] = useState(false);

  // Surface the live, edited agent to the parent (for Save/Share).
  useEffect(() => {
    onChange?.(agent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent]);

  const update: Update = (fn) =>
    setAgent((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
```
Replace that head with:
```tsx
export function BlueprintBoard({
  result,
  onChange,
  agent: agentProp,
  update: updateProp,
}: {
  result: BlueprintResult;
  onChange?: (agent: Agent) => void;
  agent?: Agent;
  update?: Update;
}) {
  const parented = agentProp !== undefined && updateProp !== undefined;
  const [ownAgent, setOwnAgent] = useState<Agent>(result.agent);
  const agent = parented ? agentProp! : ownAgent;
  const [advanced, setAdvanced] = useState(false);

  // Standalone only: surface the live, edited agent to the parent (for Save/Share).
  // When parented, the parent owns state and onChange.
  useEffect(() => {
    if (!parented) onChange?.(ownAgent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownAgent, parented]);

  const update: Update = parented
    ? updateProp!
    : (fn) =>
        setOwnAgent((prev) => {
          const next = structuredClone(prev);
          fn(next);
          return next;
        });
```
The rest of the function body (the `return (…)` using `agent`/`update`/`advanced`) is unchanged.

- [ ] **Step 2: Typecheck**

Run: `export PATH="/usr/local/opt/node@22/bin:$PATH" && npm run -w @coala/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/board.tsx
git commit -m "refactor(web): BlueprintBoard accepts parent-owned agent/update"
```

---

## Task 4: GroundingSection lens + applyGrant helper

Add a `lens` filter to `GroundingSection` (for Perceive/Act) and a reusable `applyGrant` helper (for the Memory screen's access controls).

**Files:**
- Modify: `apps/web/lib/blueprint-edit.ts`
- Modify: `apps/web/components/board.tsx` (`GroundingSection`, and `AccessSection.setGrant` to use the new helper)

- [ ] **Step 1: Add `applyGrant` to `blueprint-edit.ts`**

At the top of `apps/web/lib/blueprint-edit.ts`, add `AccessGrant` and `Agent` to the existing `import type { … } from "@coala/core";` block (AccessGrant is already imported; add `Agent`). Then append this function at the end of the file:

```ts
/**
 * Read-or-create the access grant for a module, mutate it, then drop it if it became empty.
 * Shared by the board's Access matrix and the Memory screen's plain access controls.
 */
export function applyGrant(
  update: (fn: (d: Agent) => void) => void,
  moduleId: string,
  mutate: (g: AccessGrant) => void,
): void {
  update((d) => {
    let g = d.accessPolicy.find((x) => x.memoryModuleId === moduleId);
    if (!g) {
      g = emptyGrant(moduleId);
      d.accessPolicy.push(g);
    }
    mutate(g);
    if (g.retrieval.enabled && !g.retrieval.method) g.retrieval.method = "relevance";
    const empty = !g.retrieval.enabled && !g.learning.add && !g.learning.modify && !g.learning.delete;
    if (empty) d.accessPolicy = d.accessPolicy.filter((x) => x.memoryModuleId !== moduleId);
  });
}
```

- [ ] **Step 2: Use `applyGrant` in `AccessSection`**

In `board.tsx`, add `applyGrant` to the import from `"../lib/blueprint-edit"` (the line importing `emptyGrant, newGrounding, newModule, newRubric`). Then in `AccessSection`, replace the local `setGrant` definition (the `const setGrant = (moduleId, mutate) => update((d) => { … });` block, ~lines 427-438) with:

```tsx
  const setGrant = (moduleId: string, mutate: (g: Agent["accessPolicy"][number]) => void) =>
    applyGrant(update, moduleId, mutate);
```

(The call sites `setGrant(m.id, (gr) => …)` are unchanged.)

- [ ] **Step 3: Add the `lens` prop to `GroundingSection`**

Change the signature:
```tsx
export function GroundingSection({ agent, update }: { agent: Agent; update: Update }) {
```
to:
```tsx
export function GroundingSection({
  agent,
  update,
  lens,
}: {
  agent: Agent;
  update: Update;
  lens?: "perceive" | "act";
}) {
  const title =
    lens === "perceive"
      ? "Perceive — how the world reaches your agent"
      : lens === "act"
        ? "Act — what your agent can do"
        : "Grounding — external action space";
  const hint =
    lens === "perceive"
      ? "Channels the agent receives through, plus anything it can look up."
      : lens === "act"
        ? "Messages it sends, things it changes, tools it runs."
        : "How the agent affects the outside world.";
```
Then in the `<Section …>` opening tag, replace the hard-coded `title="Grounding — external action space"` and `hint="How the agent affects the outside world."` with `title={title}` and `hint={hint}` (keep `whyId="grounding"` and the `action` prop as-is).

- [ ] **Step 4: Filter the tools by lens**

In `GroundingSection`, the digital tools are rendered by `gi.digitalTools.map((t, ti) => ( … ))`. Replace that `.map(...)` with a filtered version that preserves the original index `ti`:

```tsx
                {gi.digitalTools
                  .map((t, ti) => ({ t, ti }))
                  .filter(({ t }) =>
                    !lens ? true : lens === "perceive" ? t.sideEffect === "read" : t.sideEffect !== "read",
                  )
                  .map(({ t, ti }) => (
                    /* … the EXISTING tool-row JSX, unchanged, still using t and ti … */
                  ))}
```
The tool-row JSX inside the final `.map` is identical to today's (name Input, description Input, the side-effect `<select>`, remove IconBtn). Only the iteration wrapper changes.

- [ ] **Step 5: Lens-aware "+ tool" default**

The "+ tool" button currently does:
```tsx
onClick={() => update((d) => d.groundingInterfaces[gidx]!.digitalTools.push({ name: "tool", description: "" }))}
```
Change it so a tool added on the Perceive lens is pre-tagged `read` (so it stays on that screen):
```tsx
onClick={() =>
  update((d) =>
    d.groundingInterfaces[gidx]!.digitalTools.push(
      lens === "perceive" ? { name: "tool", description: "", sideEffect: "read" } : { name: "tool", description: "" },
    ),
  )
}
```

- [ ] **Step 6: Typecheck**

Run: `export PATH="/usr/local/opt/node@22/bin:$PATH" && npm run -w @coala/web typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/blueprint-edit.ts apps/web/components/board.tsx
git commit -m "feat(web): GroundingSection lens filter + shared applyGrant helper"
```

---

## Task 5: AgentWorkspace shell + ScreenFrame + SystemMap + page wiring

Introduce the router, a shared screen frame, the System Map, and make the workspace the default render. Detail screens are stubbed here and filled in Tasks 6–8.

**Files:**
- Create: `apps/web/components/workspace/screen-frame.tsx`
- Create: `apps/web/components/workspace/system-map.tsx`
- Create: `apps/web/components/workspace/agent-workspace.tsx`
- Modify: `apps/web/app/page.tsx`

- [ ] **Step 1: Create `screen-frame.tsx`**

```tsx
"use client";

import type { ReactNode } from "react";

/** Shared shell for every detail screen: a back link + the screen body. */
export function ScreenFrame({
  breadcrumb,
  onBack,
  children,
}: {
  breadcrumb: string;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm text-slate-400 hover:text-indigo-300">
        ← {breadcrumb}
      </button>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Create `system-map.tsx`**

```tsx
"use client";

import type { Agent } from "@coala/core";
import { MEMORY_KIND_META } from "../../lib/types";
import type { HealthSummary, Concern } from "../../lib/health";
import type { Update } from "../board";

type Go = (screen: "memory" | "perceive" | "decision" | "act" | "test" | "export" | "board", moduleId?: string) => void;

function Dot({ on }: { on: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${on ? "bg-amber-400" : "bg-emerald-500"}`}
      aria-hidden
    />
  );
}

function Node({
  emoji,
  label,
  summary,
  attention,
  onClick,
}: {
  emoji: string;
  label: string;
  summary: string;
  attention: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="min-w-[130px] rounded-xl border border-slate-700 bg-slate-900/40 px-4 py-3 text-center hover:border-indigo-500"
    >
      <div className="text-2xl">{emoji}</div>
      <div className="mt-1 flex items-center justify-center gap-1.5 text-sm font-semibold text-slate-100">
        {label} <Dot on={attention} />
      </div>
      <div className="mt-0.5 text-xs text-slate-400">{summary}</div>
    </button>
  );
}

export function SystemMap({
  agent,
  update,
  health,
  navigate,
}: {
  agent: Agent;
  update: Update;
  health: HealthSummary;
  navigate: Go;
}) {
  const memCount = agent.memoryModules.length;
  const toolCount = agent.groundingInterfaces.reduce((n, g) => n + g.digitalTools.length, 0);
  const att = (c: Concern) => health.byConcern[c];

  return (
    <div className="space-y-6">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          value={agent.name}
          onChange={(e) => update((d) => void (d.name = e.target.value))}
          className="max-w-md rounded border border-transparent bg-transparent text-2xl font-bold text-slate-100 outline-none hover:border-slate-700 focus:border-indigo-500"
        />
        <span className="rounded-md border border-slate-700 px-2 py-1 font-mono text-xs text-slate-400">
          {agent.providerConfig.provider} · {agent.providerConfig.model}
        </span>
      </div>

      {/* health banner */}
      <div
        className={`rounded-xl border px-4 py-3 text-sm ${
          health.status === "ok"
            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
            : "border-amber-500/40 bg-amber-500/10 text-amber-200"
        }`}
      >
        <strong>{health.status === "ok" ? "✓ " : "⚠ "}{health.headline}</strong>
        {health.items.length > 0 && (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs opacity-90">
            {health.items.map((it, i) => (
              <li key={i}>{it.message}</li>
            ))}
          </ul>
        )}
      </div>

      {/* the loop */}
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Node emoji="👂" label="Perceive" summary="what it receives" attention={att("perceive")} onClick={() => navigate("perceive")} />
        <span className="opacity-40">→</span>
        <div className="rounded-xl border-2 border-indigo-500 bg-indigo-500/10 p-3 text-center">
          <button onClick={() => navigate("memory")} className="text-2xl">🧠</button>
          <div className="mt-1 flex items-center justify-center gap-1.5 text-sm font-semibold text-slate-100">
            Memory <Dot on={att("memory")} />
          </div>
          <div className="mt-2 flex flex-wrap justify-center gap-1">
            {agent.memoryModules.map((m) => (
              <button
                key={m.id}
                onClick={() => navigate("memory", m.id)}
                className="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300 hover:bg-indigo-600 hover:text-white"
              >
                {MEMORY_KIND_META[m.kind].label}
              </button>
            ))}
          </div>
        </div>
        <span className="opacity-40">→</span>
        <Node emoji="⚖️" label="Decide" summary="how it chooses" attention={att("decision")} onClick={() => navigate("decision")} />
        <span className="opacity-40">→</span>
        <Node emoji="🤚" label="Act" summary={`${toolCount} tool${toolCount === 1 ? "" : "s"}`} attention={att("act")} onClick={() => navigate("act")} />
      </div>
      <div className="text-center text-xs text-slate-500">↺ the loop repeats each turn · click any part to open it</div>

      {/* utilities */}
      <div className="flex flex-wrap justify-center gap-2 text-sm">
        <button onClick={() => navigate("test")} className="rounded border border-slate-700 px-3 py-1.5 text-slate-300 hover:border-indigo-500">▶ Try it</button>
        <button onClick={() => navigate("export")} className="rounded border border-slate-700 px-3 py-1.5 text-slate-300 hover:border-indigo-500">⬇ Export</button>
        <button onClick={() => navigate("board")} className="rounded border border-slate-700 px-3 py-1.5 text-slate-400 hover:border-indigo-500">⚙ Expert view</button>
      </div>
      {memCount === 0 && <p className="text-center text-xs text-slate-500">No memory yet — open Memory to add some.</p>}
    </div>
  );
}
```

- [ ] **Step 3: Create `agent-workspace.tsx` (with temporary stub screens)**

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import type { Agent } from "@coala/core";
import type { BlueprintResult } from "../../lib/types";
import { summarizeHealth } from "../../lib/health";
import { BlueprintBoard, type Update } from "../board";
import { SystemMap } from "./system-map";
import { ScreenFrame } from "./screen-frame";

export type Screen = "map" | "memory" | "perceive" | "act" | "decision" | "test" | "export" | "board";

export function AgentWorkspace({ result, onChange }: { result: BlueprintResult; onChange?: (agent: Agent) => void }) {
  const [agent, setAgent] = useState<Agent>(result.agent);
  const [screen, setScreen] = useState<Screen>("map");
  const [focusModuleId, setFocusModuleId] = useState<string | undefined>(undefined);

  useEffect(() => {
    onChange?.(agent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent]);

  const update: Update = (fn) =>
    setAgent((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });

  const health = useMemo(() => summarizeHealth(agent), [agent]);
  const navigate = (s: Screen, moduleId?: string) => {
    setFocusModuleId(moduleId);
    setScreen(s);
  };
  const back = () => setScreen("map");

  if (screen === "board") {
    return (
      <ScreenFrame breadcrumb="Overview · Expert view" onBack={back}>
        <BlueprintBoard result={result} agent={agent} update={update} />
      </ScreenFrame>
    );
  }
  if (screen !== "map") {
    // TEMPORARY stub — replaced by real screens in Tasks 6–8.
    return (
      <ScreenFrame breadcrumb={`Overview · ${screen}`} onBack={back}>
        <p className="text-sm text-slate-400">"{screen}" screen coming next.</p>
      </ScreenFrame>
    );
  }
  return <SystemMap agent={agent} update={update} health={health} navigate={navigate} />;
}
```

- [ ] **Step 4: Wire `page.tsx` to render the workspace**

In `apps/web/app/page.tsx`:
- Change the import (line 6) from `import { BlueprintBoard } from "../components/board";` to `import { AgentWorkspace } from "../components/workspace/agent-workspace";`
- Change the render (line 372) from `<BlueprintBoard key={version} result={result} onChange={setCurrentAgent} />` to `<AgentWorkspace key={version} result={result} onChange={setCurrentAgent} />`

- [ ] **Step 5: Typecheck**

Run: `export PATH="/usr/local/opt/node@22/bin:$PATH" && npm run -w @coala/web typecheck`
Expected: PASS.

- [ ] **Step 6: Browser check**

Start dev, load a preset. Confirm: the **System Map** is now the default (not the long board); the health banner shows; the four nodes + memory chips render; clicking a node shows the stub screen with a working back link; "Expert view" opens the full board (sharing edits). Stop the server.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/workspace/ apps/web/app/page.tsx
git commit -m "feat(web): AgentWorkspace shell + SystemMap as the default view"
```

---

## Task 6: MemoryScreen

**Files:**
- Create: `apps/web/components/workspace/memory-screen.tsx`
- Modify: `apps/web/components/workspace/agent-workspace.tsx` (route to it)

- [ ] **Step 1: Create `memory-screen.tsx`**

```tsx
"use client";

import { useState } from "react";
import type { Agent } from "@coala/core";
import { MEMORY_KIND_META } from "../../lib/types";
import { applyGrant } from "../../lib/blueprint-edit";
import { ModuleEditor, type Update } from "../board";
import { Why } from "../why";
import { ScreenFrame } from "./screen-frame";

function Can({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-emerald-500" />
      {label}
    </label>
  );
}

export function MemoryScreen({
  agent,
  update,
  focusModuleId,
  onBack,
}: {
  agent: Agent;
  update: Update;
  focusModuleId?: string;
  onBack: () => void;
}) {
  const focusIdx = agent.memoryModules.findIndex((m) => m.id === focusModuleId);
  const [sel, setSel] = useState(focusIdx >= 0 ? focusIdx : 0);
  const idx = Math.min(sel, agent.memoryModules.length - 1);
  const m = agent.memoryModules[idx];

  if (!m) {
    return (
      <ScreenFrame breadcrumb="Overview · Memory" onBack={onBack}>
        <p className="text-sm text-slate-400">No memory systems yet.</p>
      </ScreenFrame>
    );
  }

  const grant = agent.accessPolicy.find((g) => g.memoryModuleId === m.id);
  const isWorking = m.kind === "working";

  return (
    <ScreenFrame breadcrumb="Overview · Memory" onBack={onBack}>
      <div className="flex flex-wrap gap-1 text-sm">
        {agent.memoryModules.map((mod, i) => (
          <button
            key={mod.id}
            onClick={() => setSel(i)}
            className={`rounded px-3 py-1 ${i === idx ? "bg-indigo-600 text-white" : "border border-slate-700 text-slate-300 hover:border-indigo-500"}`}
          >
            {MEMORY_KIND_META[mod.kind].label}
          </button>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <div className="flex items-center gap-1.5">
            <h3 className="text-lg font-semibold text-slate-100">{MEMORY_KIND_META[m.kind].label} memory</h3>
            <Why id={m.kind} />
          </div>
          <p className="mt-2 text-sm text-slate-400">{MEMORY_KIND_META[m.kind].plain}.</p>

          {isWorking ? (
            <p className="mt-4 text-xs text-slate-500">
              Working memory is the agent's scratchpad — it's always read and written during a turn, so there's nothing to grant here.
            </p>
          ) : (
            <div className="mt-4 space-y-1 rounded-lg border border-slate-800 p-3">
              <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">The agent can</div>
              <Can checked={!!grant?.retrieval.enabled} label="look things up (read)" onChange={(v) => applyGrant(update, m.id, (g) => void (g.retrieval.enabled = v))} />
              <Can checked={!!grant?.learning.add} label="add to it" onChange={(v) => applyGrant(update, m.id, (g) => void (g.learning.add = v))} />
              <Can checked={!!grant?.learning.modify} label="change it" onChange={(v) => applyGrant(update, m.id, (g) => void (g.learning.modify = v))} />
              <Can checked={!!grant?.learning.delete} label="remove from it" onChange={(v) => applyGrant(update, m.id, (g) => void (g.learning.delete = v))} />
            </div>
          )}
        </div>

        <ModuleEditor agent={agent} idx={idx} update={update} advanced={false} />
      </div>
    </ScreenFrame>
  );
}
```

- [ ] **Step 2: Route to it in `agent-workspace.tsx`**

Add the import near the other screen imports:
```tsx
import { MemoryScreen } from "./memory-screen";
```
Then, in the render, **above** the temporary stub block (`if (screen !== "map")`), add:
```tsx
  if (screen === "memory") {
    return <MemoryScreen agent={agent} update={update} focusModuleId={focusModuleId} onBack={back} />;
  }
```

- [ ] **Step 3: Typecheck**

Run: `export PATH="/usr/local/opt/node@22/bin:$PATH" && npm run -w @coala/web typecheck`
Expected: PASS.

- [ ] **Step 4: Browser check**

Load a preset → click the Memory node (and a memory chip). Confirm: sibling switcher lists all systems; selecting each shows its editor; the "The agent can…" toggles reflect/update access (Working shows the note instead); the `?` popover opens. Confirm deep-link: clicking a specific chip on the map opens that system selected. Stop the server.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/workspace/memory-screen.tsx apps/web/components/workspace/agent-workspace.tsx
git commit -m "feat(web): Memory screen — per-system editor + plain access"
```

---

## Task 7: Perceive / Act / Decision screens

**Files:**
- Create: `apps/web/components/workspace/perceive-screen.tsx`
- Create: `apps/web/components/workspace/act-screen.tsx`
- Create: `apps/web/components/workspace/decision-screen.tsx`
- Modify: `apps/web/components/workspace/agent-workspace.tsx`

- [ ] **Step 1: Create `perceive-screen.tsx`**

```tsx
"use client";

import type { Agent } from "@coala/core";
import { GroundingSection, type Update } from "../board";
import { ScreenFrame } from "./screen-frame";

export function PerceiveScreen({ agent, update, onBack }: { agent: Agent; update: Update; onBack: () => void }) {
  return (
    <ScreenFrame breadcrumb="Overview · Perceive" onBack={onBack}>
      <p className="text-sm text-slate-400">
        How the world reaches your agent — the messages it receives and the things it can look up. Dialogue and
        physical channels work both ways, so they also appear under <em>Act</em>.
      </p>
      <GroundingSection agent={agent} update={update} lens="perceive" />
    </ScreenFrame>
  );
}
```

- [ ] **Step 2: Create `act-screen.tsx`**

```tsx
"use client";

import type { Agent } from "@coala/core";
import { GroundingSection, type Update } from "../board";
import { ScreenFrame } from "./screen-frame";

export function ActScreen({ agent, update, onBack }: { agent: Agent; update: Update; onBack: () => void }) {
  return (
    <ScreenFrame breadcrumb="Overview · Act" onBack={onBack}>
      <p className="text-sm text-slate-400">
        What your agent can do in the world — reply, run tools, change things. Tools that only read are shown under
        <em> Perceive</em>; tools marked destructive are flagged here.
      </p>
      <GroundingSection agent={agent} update={update} lens="act" />
    </ScreenFrame>
  );
}
```

- [ ] **Step 3: Create `decision-screen.tsx`**

```tsx
"use client";

import type { Agent } from "@coala/core";
import { DecisionSection, type Update } from "../board";
import { ScreenFrame } from "./screen-frame";

export function DecisionScreen({ agent, update, onBack }: { agent: Agent; update: Update; onBack: () => void }) {
  return (
    <ScreenFrame breadcrumb="Overview · Decision" onBack={onBack}>
      <p className="text-sm text-slate-400">
        How your agent chooses what to do each turn: it can <strong>propose</strong> options, <strong>evaluate</strong>{" "}
        them, and <strong>select</strong> one. Simpler agents just propose; more deliberate ones do all three.
      </p>
      <DecisionSection agent={agent} update={update} />
    </ScreenFrame>
  );
}
```

- [ ] **Step 4: Route to them in `agent-workspace.tsx`**

Add imports:
```tsx
import { PerceiveScreen } from "./perceive-screen";
import { ActScreen } from "./act-screen";
import { DecisionScreen } from "./decision-screen";
```
Add these branches above the temporary stub block:
```tsx
  if (screen === "perceive") return <PerceiveScreen agent={agent} update={update} onBack={back} />;
  if (screen === "act") return <ActScreen agent={agent} update={update} onBack={back} />;
  if (screen === "decision") return <DecisionScreen agent={agent} update={update} onBack={back} />;
```

- [ ] **Step 5: Typecheck**

Run: `export PATH="/usr/local/opt/node@22/bin:$PATH" && npm run -w @coala/web typecheck`
Expected: PASS.

- [ ] **Step 6: Browser check**

Load the Retail Assistant preset. Open **Act**: confirm the `searchCatalog` digital tool (untagged) appears. Tag it `read` via its selector → it should move to **Perceive** and disappear from Act. Open **Decision**: confirm propose/evaluate toggles work. Stop the server.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/workspace/perceive-screen.tsx apps/web/components/workspace/act-screen.tsx apps/web/components/workspace/decision-screen.tsx apps/web/components/workspace/agent-workspace.tsx
git commit -m "feat(web): Perceive / Act / Decision screens"
```

---

## Task 8: Test / Export screens

**Files:**
- Create: `apps/web/components/workspace/test-screen.tsx`
- Create: `apps/web/components/workspace/export-screen.tsx`
- Modify: `apps/web/components/workspace/agent-workspace.tsx` (route + remove the temporary stub)

- [ ] **Step 1: Create `test-screen.tsx`**

```tsx
"use client";

import type { Agent } from "@coala/core";
import { RunPanel } from "../run-panel";
import { ScreenFrame } from "./screen-frame";

export function TestScreen({ agent, onBack }: { agent: Agent; onBack: () => void }) {
  return (
    <ScreenFrame breadcrumb="Overview · Try it" onBack={onBack}>
      <p className="text-sm text-slate-400">Send your agent a message and watch it run one decision cycle.</p>
      <RunPanel agent={agent} />
    </ScreenFrame>
  );
}
```

- [ ] **Step 2: Create `export-screen.tsx`**

```tsx
"use client";

import type { Agent } from "@coala/core";
import { ExportBar } from "../board";
import { ScreenFrame } from "./screen-frame";

export function ExportScreen({ agent, onBack }: { agent: Agent; onBack: () => void }) {
  return (
    <ScreenFrame breadcrumb="Overview · Export" onBack={onBack}>
      <p className="text-sm text-slate-400">Download your agent as a runnable project, or as the neutral blueprint.</p>
      <ExportBar agent={agent} />
    </ScreenFrame>
  );
}
```

- [ ] **Step 3: Route + drop the stub in `agent-workspace.tsx`**

Add imports:
```tsx
import { TestScreen } from "./test-screen";
import { ExportScreen } from "./export-screen";
```
Add branches and **remove** the temporary stub block (`if (screen !== "map") { return ( … "coming next" … ) }`):
```tsx
  if (screen === "test") return <TestScreen agent={agent} onBack={back} />;
  if (screen === "export") return <ExportScreen agent={agent} onBack={back} />;
```
After this task the render handles every `Screen` value explicitly, falling through to `<SystemMap …>` for `"map"`.

- [ ] **Step 4: Typecheck**

Run: `export PATH="/usr/local/opt/node@22/bin:$PATH" && npm run -w @coala/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/workspace/test-screen.tsx apps/web/components/workspace/export-screen.tsx apps/web/components/workspace/agent-workspace.tsx
git commit -m "feat(web): Test and Export screens; complete the workspace router"
```

---

## Task 9: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck + production build**

```bash
export PATH="/usr/local/opt/node@22/bin:$PATH"
npm run -w @coala/web typecheck
npm run -w @coala/web build
```
Expected: typecheck clean; `next build` completes with no errors.

- [ ] **Step 2: Browser walkthrough**

Start dev (`npm run -w @coala/web dev`), load the Retail Assistant preset, and confirm:
- The **System Map** is the landing view with a health banner and four nodes (memory chips visible).
- Click each node → its screen opens; the back link returns to the map.
- In **Memory**, switch between systems; toggle an access checkbox; return to the map and confirm the health/dots reflect changes (e.g. enabling `delete` on a long-term store surfaces an "unlearning" note and lights the Memory dot).
- In **Act**, a `destructive`-tagged tool shows its warning; tagging a tool `read` moves it to **Perceive**.
- **Try it** runs a turn (with a provider key) or shows the placeholder; **Export** downloads; **Expert view** shows the full board and shares edits with the map.
Stop the server.

- [ ] **Step 3: Final status check**

```bash
git status   # expect clean
git log --oneline feat/coala-ux-gaps..HEAD
```

---

## Self-review notes (author)

- **Spec coverage:** architecture/router (Task 5), System Map + health (Tasks 1, 5), detail screens with two-column explanation+editor (Tasks 6–7), Memory sibling-switcher + folded access (Task 6), Perceive/Act grounding filter via `sideEffect` (Task 4 + 7), Decision (Task 7), Test/Export/Expert reuse (Tasks 5, 8), `page.tsx` default render (Task 5). All spec sections map to a task.
- **No placeholders:** the one "move verbatim" instruction (Task 2 Step 2) refers to existing repo code being relocated unchanged, with the exact wrapper signature and in-scope symbols listed — not new logic to invent.
- **Type consistency:** `Update` (exported Task 2) used by every screen; `Screen` union (Task 5) covers all branches and is fully handled after Task 8; `HealthSummary`/`Concern` (Task 1) consumed by `SystemMap` (Task 5); `ModuleEditor`/`GroundingSection`/`DecisionSection`/`ExportBar` exported in Tasks 2 & 4 before first use in Tasks 6–8; `applyGrant` (Task 4) used in Task 6.
- **No test runner in apps/web** is expected; web verification is typecheck + build + browser, matching the prior feature and CLAUDE.md's execution-not-just-compilation expectation (the browser walkthrough is the behavioral gate).
