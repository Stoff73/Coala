# CoALA UX Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a destructive-digital-tool safety warning to the CoALA linter, and "Why?" paper-quote popovers across the Blueprint Board.

**Architecture:** Feature 1 extends the single `@coala/core` `Agent` contract — a new optional `sideEffect` field on `DigitalTool` plus a new `destructiveToolSafety` linter rule (declared tag OR name/description heuristic). Feature 2 is web-only: a pure-data glossary of verbatim paper quotes and a small `<Why>` popover component wired into `apps/web/components/board.tsx`. Both consume the same blueprint, so persistence/inference/export need no changes.

**Tech Stack:** TypeScript (ESM, NodeNext), zod, vitest (packages), Next.js 14 + React + Tailwind (apps/web). Node ≥18.17 required for `apps/web` — use `export PATH="/usr/local/opt/node@22/bin:$PATH"`.

**Reference docs to keep open:**
- Spec: `docs/superpowers/specs/2026-06-02-coala-ux-gaps-design.md`
- Source paper: `2309.02427v3.pdf` (quotes below are already extracted — no need to re-read it)
- `packages/core/src/invariants/lint.ts` (existing rule patterns), `packages/core/src/schema/{common,action}.ts`
- `apps/web/components/board.tsx` (board structure), `apps/web/lib/types.ts` (`MEMORY_KIND_META`)

**Build-order reminder:** cross-package imports resolve through each package's built `dist/`. After changing `@coala/core`, rebuild it (`npm run -w @coala/core build`) before the web app typechecks against the new field.

---

## Feature 1 — `sideEffect` field + destructive-tool linter rule

### Task 1: Add `SideEffect` enum + `DigitalTool.sideEffect` field

**Files:**
- Modify: `packages/core/src/schema/common.ts` (add enum near the other enums, after `GroundingType`)
- Modify: `packages/core/src/schema/action.ts:31-37` (`DigitalTool`)
- Test: `packages/core/src/__tests__/action.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/__tests__/action.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DigitalTool } from "../schema/action.js";

describe("DigitalTool.sideEffect", () => {
  it("accepts a valid side-effect class", () => {
    const t = DigitalTool.parse({ name: "deleteRecord", sideEffect: "destructive" });
    expect(t.sideEffect).toBe("destructive");
  });

  it("leaves sideEffect undefined when omitted", () => {
    const t = DigitalTool.parse({ name: "searchCatalog" });
    expect(t.sideEffect).toBeUndefined();
  });

  it("rejects an unknown side-effect value", () => {
    expect(() => DigitalTool.parse({ name: "x", sideEffect: "nuke" })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run -w @coala/core test -- src/__tests__/action.test.ts`
Expected: FAIL — the first test fails because `sideEffect` is stripped/undefined (unknown key) and/or the third test fails (no validation). (vitest reports the assertion failure.)

- [ ] **Step 3: Add the `SideEffect` enum**

In `packages/core/src/schema/common.ts`, immediately after the `GroundingType` block (the `export type GroundingType = ...` line), add:

```ts
/**
 * Side-effect class of an external digital tool (paper §6, "safety of the action space").
 * Drives the destructive-tool safety warning. Unset → the linter infers from name/description.
 */
export const SideEffect = z.enum(["read", "write", "destructive"]);
export type SideEffect = z.infer<typeof SideEffect>;
```

- [ ] **Step 4: Add the field to `DigitalTool`**

In `packages/core/src/schema/action.ts`, update the import and the `DigitalTool` object:

Change line 2 import to include `SideEffect`:

```ts
import { GroundingType, Id, RecordSchema, RetrievalMethod, SideEffect } from "./common.js";
```

Replace the `DigitalTool` definition (lines 31-37) with:

```ts
/** A digital tool / API the agent may call as an external action (paper §4.2). */
export const DigitalTool = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  /** Argument schema for the tool call, when defined. */
  inputSchema: RecordSchema.optional(),
  /** Side-effect class; drives the destructive-tool safety warning (§6). Unset → inferred. */
  sideEffect: SideEffect.optional(),
});
export type DigitalTool = z.infer<typeof DigitalTool>;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run -w @coala/core test -- src/__tests__/action.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/schema/common.ts packages/core/src/schema/action.ts packages/core/src/__tests__/action.test.ts
git commit -m "feat(core): add SideEffect class to DigitalTool"
```

---

### Task 2: `destructiveToolSafety` linter rule

**Files:**
- Modify: `packages/core/src/invariants/lint.ts` (add rule after `safetyFlags`, register in `RULES`)
- Test: `packages/core/src/__tests__/lint.test.ts` (add cases)

**Heuristic note:** tool names use underscores/camelCase (`delete_record`, `deleteRecord`). A plain
`\bdelete\b` regex does NOT match `delete_record` (`_` is a word char, so there is no boundary). Use
letter-only lookarounds against a lowercased haystack: `(?<![a-z])(verb)(?![a-z])`. Node ≥18 supports
lookbehind.

- [ ] **Step 1: Write the failing tests**

In `packages/core/src/__tests__/lint.test.ts`, add these cases inside the `describe("CoALA invariants", ...)` block (before the closing `});`). They reuse the existing `mutate` helper and `ruleNames`:

```ts
  it("warns (heuristic) on an untagged tool whose name looks destructive", () => {
    const a = mutate((x) => {
      x.groundingInterfaces[0]!.type = "digital";
      x.groundingInterfaces[0]!.digitalTools = [
        { name: "delete_record", description: "" },
      ];
    });
    const f = lintAgent(a).findings;
    expect(f.some((x) => x.rule === "destructive-tool-safety" && x.severity === "warning")).toBe(true);
  });

  it("warns on a tool explicitly tagged destructive", () => {
    const a = mutate((x) => {
      x.groundingInterfaces[0]!.type = "digital";
      x.groundingInterfaces[0]!.digitalTools = [
        { name: "ship", description: "Send the order", sideEffect: "destructive" },
      ];
    });
    expect(ruleNames(a)).toContain("destructive-tool-safety");
  });

  it("does NOT warn when a destructive-looking tool is explicitly tagged read", () => {
    const a = mutate((x) => {
      x.groundingInterfaces[0]!.type = "digital";
      x.groundingInterfaces[0]!.digitalTools = [
        { name: "remove_filter", description: "remove a UI filter (no external effect)", sideEffect: "read" },
      ];
    });
    expect(ruleNames(a)).not.toContain("destructive-tool-safety");
  });

  it("does NOT warn on an innocuous untagged tool", () => {
    const a = mutate((x) => {
      x.groundingInterfaces[0]!.type = "digital";
      x.groundingInterfaces[0]!.digitalTools = [
        { name: "searchCatalog", description: "Search products" },
      ];
    });
    expect(ruleNames(a)).not.toContain("destructive-tool-safety");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run -w @coala/core test -- src/__tests__/lint.test.ts`
Expected: FAIL — the two "warns" cases fail (rule does not exist yet, so the finding is absent).

- [ ] **Step 3: Implement the rule**

In `packages/core/src/invariants/lint.ts`, add this rule definition immediately after the `safetyFlags` rule (after its closing `};`, before `ltmShouldHaveSchema`):

```ts
/**
 * External-action-space safety (§6). A "destructive" digital tool may have irreversible
 * effects on the world (the paper names "rm" in a bash terminal as an example). Warn when a
 * tool is declared destructive, or — when untagged — when its name/description matches a
 * destructive verb. An explicit read/write tag suppresses the heuristic.
 */
const DESTRUCTIVE_VERBS = [
  "delete", "remove", "drop", "purge", "destroy", "wipe", "erase", "truncate",
  "overwrite", "terminate", "uninstall", "revoke", "transfer", "pay", "charge",
  "refund", "deploy",
] as const;

// Letter-only lookarounds so "delete_record" / "deleteRecord" match but "undeleted" does not.
const DESTRUCTIVE_RE = new RegExp(`(?<![a-z])(${DESTRUCTIVE_VERBS.join("|")})(?![a-z])`);

const destructiveToolSafety: Rule = (agent) => {
  const findings: Finding[] = [];
  agent.groundingInterfaces.forEach((gi, gidx) => {
    if (gi.type !== "digital") return;
    gi.digitalTools.forEach((tool, tidx) => {
      const path = `groundingInterfaces[${gidx}].digitalTools[${tidx}]`;
      if (tool.sideEffect === "destructive") {
        findings.push({
          rule: "destructive-tool-safety",
          severity: "warning",
          message: `Tool "${tool.name}" is declared destructive — its effects on the world may be irreversible (the paper names "rm" in a bash terminal as an example). Confirm the decision procedure gates it (§6).`,
          path,
        });
        return;
      }
      // Explicit read/write tag means the designer has classified it — trust them.
      if (tool.sideEffect) return;
      const match = DESTRUCTIVE_RE.exec(`${tool.name} ${tool.description}`.toLowerCase());
      if (match) {
        findings.push({
          rule: "destructive-tool-safety",
          severity: "warning",
          message: `Tool "${tool.name}" looks destructive (matched "${match[1]}"). Tag its side-effect (read / write / destructive) to confirm or silence this (§4.2, §6).`,
          path,
        });
      }
    });
  });
  return findings;
};
```

Then register it in the `RULES` array — add `destructiveToolSafety,` immediately after `safetyFlags,`:

```ts
const RULES: Rule[] = [
  proceduralRequired,
  workingRequired,
  groundingRequired,
  accessIntegrity,
  safetyFlags,
  destructiveToolSafety,
  ltmShouldHaveSchema,
  actionSpaceVsDecision,
];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run -w @coala/core test -- src/__tests__/lint.test.ts`
Expected: PASS — all lint cases green (the original 8 + the 4 new).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/invariants/lint.ts packages/core/src/__tests__/lint.test.ts
git commit -m "feat(core): warn on destructive digital tools (declared + heuristic)"
```

---

### Task 3: Regression — presets stay warning-clean for the new rule

**Files:**
- Test: `packages/core/src/__tests__/presets.test.ts` (add one assertion)

- [ ] **Step 1: Inspect the existing presets test**

Run: `sed -n '1,60p' packages/core/src/__tests__/presets.test.ts`
Goal: find how presets are imported/iterated (there is an array of all presets) so the new assertion matches the file's style. If a `presets` array or per-preset loop already exists, reuse it; otherwise import from `../presets/index.js`.

- [ ] **Step 2: Write the failing/guard test**

Add this block (adapt the preset collection name to whatever the file already uses — e.g. `presets` or `allPresets`; if none, `import { presets } from "../presets/index.js";`):

```ts
import { lintAgent } from "../invariants/lint.js";
// ...inside the existing describe, or a new one:
it("no preset trips the destructive-tool heuristic", () => {
  for (const agent of presets) {
    const hits = lintAgent(agent).findings.filter((f) => f.rule === "destructive-tool-safety");
    expect(hits, `${agent.name} unexpectedly flagged: ${hits.map((h) => h.message).join("; ")}`).toHaveLength(0);
  }
});
```

(If `lintAgent` is already imported in this file, do not import it twice.)

- [ ] **Step 3: Run the test**

Run: `npm run -w @coala/core test -- src/__tests__/presets.test.ts`
Expected: PASS — none of `searchCatalog`/`act`/`executeSkill`/`submitAnswer`/`search`/`lookup`/`finish` match the verb list, so zero findings.

- [ ] **Step 4: Run the whole core suite**

Run: `npm run -w @coala/core test`
Expected: PASS — all core tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/__tests__/presets.test.ts
git commit -m "test(core): assert presets do not trip the destructive-tool heuristic"
```

---

### Task 4: Board editor — `sideEffect` selector on digital tools

**Files:**
- Modify: `apps/web/components/board.tsx:523-529` (the per-tool row in `GroundingSection`)

- [ ] **Step 1: Rebuild core so the web app sees the new field**

Run: `npm run -w @coala/core build`
Expected: builds clean (emits updated `dist/`).

- [ ] **Step 2: Add the selector to the tool row**

In `apps/web/components/board.tsx`, replace the per-tool row (lines 523-529, the `gi.digitalTools.map(...)` body) with the version that adds a side-effect `<select>` between the description input and the remove button. The select uses a native `<select>` (not the typed `Select` helper, because the value can be "unset"):

```tsx
                {gi.digitalTools.map((t, ti) => (
                  <div key={ti} className="mb-1 flex items-center gap-1">
                    <Input value={t.name} mono onChange={(v) => update((d) => void (d.groundingInterfaces[gidx]!.digitalTools[ti]!.name = v))} className="w-40" />
                    <Input value={t.description} onChange={(v) => update((d) => void (d.groundingInterfaces[gidx]!.digitalTools[ti]!.description = v))} className="flex-1" placeholder="description" />
                    <select
                      value={t.sideEffect ?? ""}
                      title="Side-effect class (drives the destructive-tool safety warning)"
                      onChange={(e) =>
                        update((d) => {
                          const v = e.target.value;
                          d.groundingInterfaces[gidx]!.digitalTools[ti]!.sideEffect =
                            v === "" ? undefined : (v as "read" | "write" | "destructive");
                        })
                      }
                      className="rounded border border-slate-700 bg-slate-950 px-1 py-1 text-xs outline-none focus:border-indigo-500"
                    >
                      <option value="">effect…</option>
                      <option value="read">read</option>
                      <option value="write">write</option>
                      <option value="destructive">destructive</option>
                    </select>
                    <IconBtn title="Remove tool" onClick={() => update((d) => d.groundingInterfaces[gidx]!.digitalTools.splice(ti, 1))}>✕</IconBtn>
                  </div>
                ))}
```

(The remove button is unchanged from the original — only the side-effect `<select>` is inserted before it.)

- [ ] **Step 3: Typecheck the web app**

Run: `export PATH="/usr/local/opt/node@22/bin:$PATH" && npm run -w @coala/web typecheck`
Expected: PASS — `t.sideEffect` is now a known optional field, the union cast typechecks.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/board.tsx
git commit -m "feat(web): side-effect selector on digital tools in the board"
```

---

## Feature 2 — "Why?" paper-quote popovers

### Task 5: Glossary content module (verbatim paper quotes)

**Files:**
- Create: `apps/web/lib/coala-glossary.ts`

- [ ] **Step 1: Create the glossary**

Create `apps/web/lib/coala-glossary.ts` with the exact content below. Quotes are verbatim from `2309.02427v3.pdf`; `cite` matches the §-style already used in linter messages.

```ts
/**
 * Verbatim quotes from the CoALA paper (Sumers et al., TMLR 2024 — `2309.02427v3.pdf`),
 * keyed by board concept. Rendered by the <Why> popover so the UI teaches the framework inline.
 */
export interface GlossaryEntry {
  quote: string;
  cite: string;
}

export const COALA_GLOSSARY: Record<string, GlossaryEntry> = {
  // --- sections ---
  memory: {
    quote:
      "Under the CoALA framework, language agents explicitly organize information (mainly textual, but other modalities also allowed) into multiple memory modules, each containing a different form of information. These include short-term working memory and several long-term memories: episodic, semantic, and procedural.",
    cite: "§4.1",
  },
  access: {
    quote:
      "Agents' action spaces can be divided into internal memory accesses and external interactions with the world. Defining the agent's internal action space consists primarily of defining read and write access to each of the agent's memory modules.",
    cite: "§4.3–4.5, §6",
  },
  grounding: {
    quote:
      "Grounding procedures execute external actions and process environmental feedback into working memory as text. This effectively simplifies the agent's interaction with the outside world as a “text game” with textual observations and actions.",
    cite: "§4.2",
  },
  decision: {
    quote:
      "CoALA structures this top-level program into decision cycles which yield an external grounding action or internal learning action. In each cycle, program code defines a sequence of reasoning or retrieval actions to propose and evaluate alternatives (planning stage), then executes the selected action (execution stage).",
    cite: "§4.6",
  },

  // --- memory kinds ---
  working: {
    quote:
      "Working memory maintains active and readily available information as symbolic variables for the current decision cycle. It thus serves as the central hub connecting different components of a language agent.",
    cite: "§4.1",
  },
  episodic: {
    quote:
      "Episodic memory stores experience from earlier decision cycles. During the planning stage of a decision cycle, these episodes may be retrieved into working memory to support reasoning. An agent can also write new experiences from working to episodic memory as a form of learning.",
    cite: "§4.1",
  },
  semantic: {
    quote:
      "Semantic memory stores an agent's knowledge about the world and itself.",
    cite: "§4.1",
  },
  procedural: {
    quote:
      "Language agents contain two forms of procedural memory: implicit knowledge stored in the LLM weights, and explicit knowledge written in the agent's code. Unlike episodic or semantic memory that may be initially empty or even absent, procedural memory must be initialized by the designer with proper code to bootstrap the agent.",
    cite: "§4.1",
  },

  // --- retrieval methods (the paper defines recency/importance/relevance jointly via Generative Agents) ---
  recency: {
    quote:
      "Generative Agents retrieves relevant events from episodic memory via a combination of recency (rule-based), importance (reasoning-based), and relevance (embedding-based) scores.",
    cite: "§4.3",
  },
  importance: {
    quote:
      "Generative Agents retrieves relevant events from episodic memory via a combination of recency (rule-based), importance (reasoning-based), and relevance (embedding-based) scores.",
    cite: "§4.3",
  },
  relevance: {
    quote:
      "Generative Agents retrieves relevant events from episodic memory via a combination of recency (rule-based), importance (reasoning-based), and relevance (embedding-based) scores.",
    cite: "§4.3",
  },
  embedding: {
    quote:
      "Voyager loads code-based skills from a skill library via dense retrieval to interact with the Minecraft world.",
    cite: "§4.3",
  },
  rule: {
    quote:
      "In CoALA, a retrieval procedure reads information from long-term memories into working memory. Depending on the information and memory type, it could be implemented in various ways, e.g., rule-based, sparse, or dense retrieval.",
    cite: "§4.3",
  },

  // --- learning operations ---
  "learning-add": {
    quote:
      "Learning occurs by writing information to long-term memory, which includes a spectrum of diverse procedures. Added experiences in episodic memory may be retrieved later as examples and bases for reasoning or decision-making.",
    cite: "§4.5",
  },
  "learning-modify": {
    quote:
      "While our discussion has mostly focused on adding to memory, modifying and deleting (a case of “unlearning”) are understudied in recent language agents.",
    cite: "§4.5",
  },
  "learning-delete": {
    quote:
      "New forms of learning (and unlearning) could include … deleting unneeded memory items for “unlearning”, and studying the interaction effects between multiple forms of learning.",
    cite: "§4.5, §6",
  },

  // --- grounding types ---
  dialogue: {
    quote:
      "Classic linguistic interactions allow the agent to accept instructions or learn from people. Agents capable of generating language may ask for help or clarification — or entertain or emotionally help people.",
    cite: "§4.2",
  },
  physical: {
    quote:
      "Physical embodiment is the oldest instantiation envisioned for AI agents. It involves processing perceptual inputs (visual, audio, tactile) into textual observations, and affecting the physical environments via robotic planners that take language-based commands.",
    cite: "§4.2",
  },
  digital: {
    quote:
      "This includes interacting with games, APIs, and websites as well as general code execution. Such digital grounding is cheaper and faster than physical or human interaction. It is thus a convenient testbed for language agents.",
    cite: "§4.2",
  },

  // --- decision sub-stages ---
  proposal: {
    quote:
      "The proposal sub-stage generates one or more action candidates. The usual approach is to use reasoning (and optionally retrieval) to sample one or more external grounding actions from the LLM.",
    cite: "§4.6",
  },
  evaluation: {
    quote:
      "If multiple actions are proposed, the evaluation sub-stage assigns a value to each. This may use heuristic rules, LLM (perplexity) values, learned values, LLM reasoning, or some combination.",
    cite: "§4.6",
  },
  selection: {
    quote:
      "Given a set of actions and their values, the selection step either selects one to execute or rejects them and loops back to the proposal step. Depending on the form of action values, selection may occur via argmax, softmax, or an alternative such as majority vote.",
    cite: "§4.6",
  },
};
```

- [ ] **Step 2: Typecheck**

Run: `export PATH="/usr/local/opt/node@22/bin:$PATH" && npm run -w @coala/web typecheck`
Expected: PASS — pure data module, no references yet.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/coala-glossary.ts
git commit -m "feat(web): CoALA glossary of verbatim paper quotes"
```

---

### Task 6: `<Why>` popover component

**Files:**
- Create: `apps/web/components/why.tsx`

- [ ] **Step 1: Create the component**

Create `apps/web/components/why.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { COALA_GLOSSARY } from "../lib/coala-glossary";

/**
 * A subtle "(?)" button that reveals a verbatim CoALA paper quote for `id`.
 * Renders nothing if `id` is not in the glossary (keeps wiring forgiving).
 */
export function Why({ id }: { id: string }) {
  const entry = COALA_GLOSSARY[id];
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!entry) return null;

  return (
    <span ref={ref} className="relative inline-block align-middle">
      <button
        type="button"
        aria-label={`Why: ${id}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-600 text-[10px] leading-none text-slate-400 hover:border-indigo-500 hover:text-indigo-300"
      >
        ?
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute left-1/2 top-6 z-50 w-72 -translate-x-1/2 rounded-lg border border-slate-700 bg-slate-900 p-3 text-left text-xs font-normal normal-case text-slate-200 shadow-xl"
        >
          <span className="block italic leading-relaxed">{`“${entry.quote}”`}</span>
          <span className="mt-2 block font-mono text-[10px] uppercase tracking-wide text-slate-500">
            CoALA paper · {entry.cite}
          </span>
        </span>
      )}
    </span>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `export PATH="/usr/local/opt/node@22/bin:$PATH" && npm run -w @coala/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/why.tsx
git commit -m "feat(web): Why popover component for inline paper quotes"
```

---

### Task 7: Wire `<Why>` into the board

**Files:**
- Modify: `apps/web/components/board.tsx` — import; `Section` `whyId` prop; section headers; memory-kind, retrieval/learning, grounding-type, and decision-stage anchors.

- [ ] **Step 1: Import the component**

Add to the import block at the top of `apps/web/components/board.tsx` (after the `RunPanel` import, line 27):

```tsx
import { Why } from "./why";
```

- [ ] **Step 2: Add a `whyId` prop to `Section`**

Replace the `Section` function (lines 109-127) with:

```tsx
function Section({ title, hint, action, children, whyId }: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  whyId?: string;
}) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/30 p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-1.5 text-lg font-semibold text-slate-100">
            {title}
            {whyId && <Why id={whyId} />}
          </h3>
          {hint && <p className="text-xs text-slate-400">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
```

- [ ] **Step 3: Tag the four section headers**

Add `whyId` to each `<Section>` that maps to a concept:

- Memory section (line ~163): add `whyId="memory"` to the `<Section title="Memory modules" ...>`.
- Access section (line ~434): add `whyId="access"` to `<Section title="Access — internal action space" ...>`.
- Grounding section (line ~500): add `whyId="grounding"` to `<Section title="Grounding — external action space" ...>`.
- Decision section (line ~601): add `whyId="decision"` to `<Section title="Decision procedure" ...>`.

Example for the grounding one:

```tsx
    <Section
      title="Grounding — external action space"
      hint="How the agent affects the outside world."
      whyId="grounding"
      action={<IconBtn title="Add interface" onClick={() => update((d) => d.groundingInterfaces.push(newGrounding()))}>+ interface</IconBtn>}
    >
```

- [ ] **Step 4: Memory-kind anchor**

In `MemorySection`, the per-module header has a kind `<Select>` (lines 182-195) followed by the delete button. Add a `<Why>` for the module's kind right after that `<Select>`'s closing `/>` (line 195), inside the `flex` header div:

```tsx
                  onChange={(kind) =>
                    update((d) => {
                      const mod = d.memoryModules[idx]!;
                      mod.kind = kind;
                      mod.backingStore.type =
                        kind === "working" ? "kv" : kind === "procedural" ? "code" : "pgvector";
                      if ((kind === "semantic" || kind === "episodic") && !mod.schema)
                        mod.schema = { title: "Record", fields: [] };
                    })
                  }
                />
                <Why id={m.kind} />
                <IconBtn title="Delete module" onClick={() => update((d) => d.memoryModules.splice(idx, 1))}>
```

(Insert the single `<Why id={m.kind} />` line between the `</Select>`-closing `/>` and the delete `<IconBtn>`.)

- [ ] **Step 5: Retrieval-method + learning-op anchors (Access table headers)**

In `AccessSection`, replace the table header row (lines 443-449) so the column labels carry `<Why>` (Read→`rule`, Add→`learning-add`, Modify→`learning-modify`, Delete→`learning-delete`):

```tsx
            <tr className="text-xs uppercase tracking-wide text-slate-400">
              <th className="px-2 py-2 text-left">Memory</th>
              <th className="px-2 py-2"><span className="inline-flex items-center gap-1">Read <Why id="rule" /></span></th>
              <th className="px-2 py-2"><span className="inline-flex items-center gap-1">Add <Why id="learning-add" /></span></th>
              <th className="px-2 py-2"><span className="inline-flex items-center gap-1">Modify <Why id="learning-modify" /></span></th>
              <th className="px-2 py-2"><span className="inline-flex items-center gap-1">Delete <Why id="learning-delete" /></span></th>
            </tr>
```

Additionally, anchor the active retrieval method: in the retrieval cell (lines 467-473), add a `<Why>` keyed to the chosen method right after the method `<Select>`:

```tsx
                      {g?.retrieval.enabled && (
                        <>
                          <Select
                            value={g.retrieval.method ?? "relevance"}
                            options={RetrievalMethod.options}
                            onChange={(v) => setGrant(m.id, (gr) => void (gr.retrieval.method = v))}
                          />
                          <Why id={g.retrieval.method ?? "relevance"} />
                        </>
                      )}
```

- [ ] **Step 6: Grounding-type anchor**

In `GroundingSection`, the interface `<Select>` for `gi.type` (lines 509-513) — add a `<Why>` keyed to the selected grounding type right after it:

```tsx
              <Select
                value={gi.type}
                options={GroundingType.options}
                onChange={(v) => update((d) => void (d.groundingInterfaces[gidx]!.type = v))}
              />
              <Why id={gi.type} />
              <Input value={gi.name} onChange={(v) => update((d) => void (d.groundingInterfaces[gidx]!.name = v))} className="flex-1" />
```

- [ ] **Step 7: Decision sub-stage anchors**

In `DecisionSection`, the `stages` array maps `key` (Propose/Evaluate/Select) to fields. Add a glossary id to each stage entry and render a `<Why>` next to the `<Check>` label. Replace the `stages` array (lines 595-599) and the stage row (lines 611-627):

```tsx
  const stages = [
    { key: "Propose", field: "proposal" as const, stage: p.proposal, why: "proposal" },
    { key: "Evaluate", field: "evaluation" as const, stage: p.evaluation, why: "evaluation" },
    { key: "Select", field: "selection" as const, stage: p.selection, why: "selection" },
  ];
```

```tsx
        {stages.map(({ key, field, stage, why }) => (
          <div key={key} className="flex items-center gap-2">
            <Check
              checked={stage.enabled}
              onChange={(v) => update((d) => void (d.decisionProcedure.planning[field].enabled = v))}
              label={key}
            />
            <Why id={why} />
            {stage.enabled && (
              <Input
                value={stage.strategy ?? ""}
                onChange={(v) => update((d) => void (d.decisionProcedure.planning[field].strategy = v))}
                placeholder="strategy"
                className="flex-1"
              />
            )}
          </div>
        ))}
```

- [ ] **Step 8: Typecheck the web app**

Run: `export PATH="/usr/local/opt/node@22/bin:$PATH" && npm run -w @coala/web typecheck`
Expected: PASS — all `<Why id=...>` ids are strings; `m.kind`, `gi.type`, and `g.retrieval.method` are valid glossary keys.

- [ ] **Step 9: Commit**

```bash
git add apps/web/components/board.tsx
git commit -m "feat(web): wire Why popovers across the blueprint board"
```

---

### Task 8: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full package test suite**

Run: `npm test`
Expected: PASS — total rises from 70 to ~77 (4 new lint cases + 3 new action cases + 1 preset assertion; exact count may vary). Zero failures.

- [ ] **Step 2: Rebuild all packages in dependency order + web build**

Run:
```bash
export PATH="/usr/local/opt/node@22/bin:$PATH"
npm run build
npm run -w @coala/web build
```
Expected: every package builds; `next build` completes (typecheck + production build) with no errors.

- [ ] **Step 3: Visual smoke test (Playwright or manual)**

Start the dev server (`export PATH="/usr/local/opt/node@22/bin:$PATH" && npm run -w @coala/web dev`), open a preset blueprint, and confirm:
- Each board section header shows a `(?)` icon; clicking opens a quote popover; clicking outside / Esc closes it.
- In Grounding, add a digital tool named `delete_record` (leave the effect select on "effect…"): the Findings panel shows an amber `destructive-tool-safety` warning.
- Set that tool's effect select to `read`: the warning disappears. Set it to `destructive`: the warning returns with the "declared destructive" wording.

- [ ] **Step 4: Final commit (if any uncommitted verification fixups)**

```bash
git status   # expect clean; commit only if a fix was needed
```

---

## Self-review notes (author)

- **Spec coverage:** Feature 1 schema (Task 1), linter rule incl. heuristic + declared + tag-suppression (Task 2), presets regression (Task 3, replaces the spec's now-corrected preset-tagging step), board selector (Task 4). Feature 2 glossary (Task 5), `Why` component (Task 6), all wiring anchors — sections, memory kinds, retrieval, learning, grounding types, decision stages (Task 7), verification (Task 8). All spec sections map to a task.
- **Heuristic correctness:** lookbehind/lookahead are letter-only so `delete_record`/`deleteRecord` match and `undeleted` does not — encoded in the regex and covered by the Task 2 tests.
- **Type consistency:** `SideEffect` = `"read"|"write"|"destructive"` used identically in schema (Task 1), board cast (Task 4), and glossary is keyed by independent concept strings (not the enum). `destructive-tool-safety` rule name is identical across Task 2 impl, Task 2 tests, and Task 3 assertion.
- **No placeholders:** every code step shows complete, copy-ready code. Task 3 Step 1 is an explicit "inspect first" step because the presets-test collection name must match the existing file rather than be assumed.
