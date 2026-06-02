# Design — CoALA UX gaps: destructive-tool linter warning + "Why?" paper-quote popovers

**Date:** 2026-06-02
**Status:** Approved (design); pending spec review → implementation plan
**Scope:** Two carried-forward UX gaps from `june/june01/handover-session-2.md`, built in order:
1. A destructive-digital-tool safety warning in the CoALA linter (extends §6 "safety of the action space" to the external action space).
2. "Why?" popovers across the Blueprint Board showing verbatim quotes from the source paper.

Both consume/extend the single `Agent` contract in `@coala/core`. Feature 1 is contained and test-backed; Feature 2 is web-only content + UI.

---

## Background

The linter (`packages/core/src/invariants/lint.ts`) already encodes CoALA invariants as a list of
`Rule` functions. Its `safetyFlags` rule warns on **internal** destructive actions:
`procedural-write-safety` (agent rewriting its own code) and `unlearning-safety` (deleting memory
items). Both are `severity: "warning"`, never errors — they teach without blocking.

There is no equivalent guard for the **external** action space. A `DigitalTool`
(`packages/core/src/schema/action.ts`) is `{ name, description, inputSchema? }` — it carries no
notion of side-effects, so the linter currently cannot warn that e.g. a `delete_account` tool is
irreversible.

The Blueprint Board (`apps/web/components/board.tsx`) teaches the framework inline via section
`hint`s and `MEMORY_KIND_META` plain-language labels, but there are no citations to the source
paper (`2309.02427v3.pdf`, repo root) explaining *why* each CoALA concept exists.

---

## Feature 1 — `sideEffect` field + destructive-tool linter rule

### Decision (chosen approach)

**Explicit field + heuristic fallback.** Add an optional `sideEffect` to `DigitalTool`; the linter
warns when it is `"destructive"`, and falls back to a name/description heuristic when it is unset.
This is the most design-true option (§6) and teaches out of the box (untagged tools that *look*
destructive still warn), at the cost of rippling a field through schema → presets → board editor.

### Schema changes (`packages/core`)

`src/schema/common.ts` — add:

```ts
/** External-action side-effect class (paper §6, "safety of the action space"). */
export const SideEffect = z.enum(["read", "write", "destructive"]);
export type SideEffect = z.infer<typeof SideEffect>;
```

`src/schema/action.ts` — extend `DigitalTool`:

```ts
export const DigitalTool = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  inputSchema: RecordSchema.optional(),
  /** Side-effect class; drives the destructive-tool safety warning (§6). Unset → inferred. */
  sideEffect: SideEffect.optional(),
});
```

Optional ⇒ no existing preset or stored blueprint breaks. Re-export `SideEffect` from
`packages/core/src/index.ts` (next to the other enum exports) so the web app can import it.

### Linter rule (`src/invariants/lint.ts`)

New `Rule` named `destructiveToolSafety`, registered in `RULES` immediately after `safetyFlags`:

- Iterate every `groundingInterface` of `type === "digital"` and each of its `digitalTools`.
- **Declared:** if `tool.sideEffect === "destructive"` → emit a warning:
  *"Tool \"<name>\" is declared destructive — its effects on the world may be irreversible; confirm the decision procedure gates it (§6)."*
- **Inferred:** else if `tool.sideEffect` is unset **and** the lowercased `name`+`description`
  matches the destructive-verb list (word-boundary match) → emit a warning:
  *"Tool \"<name>\" looks destructive (matched \"<verb>\"). Tag its side-effect to confirm, or set it to read/write to silence (§6)."*
- Tools tagged `"read"` or `"write"` are never flagged, even if the name matches a verb (an explicit
  tag wins over the heuristic).
- `rule: "destructive-tool-safety"`, `severity: "warning"`, `path: "groundingInterfaces[<gi>].digitalTools[<ti>]"`.

**Destructive-verb list** (curated, conservative to limit false positives):
`delete, remove, drop, purge, destroy, wipe, erase, truncate, overwrite, terminate, uninstall,
revoke, transfer, pay, charge, refund, deploy`. Matched as whole words against
`(name + " " + description).toLowerCase()`.

### Board editor (`apps/web/components/board.tsx`)

In the grounding section's per-tool editor (currently name + description inputs, ~`board.tsx:521`),
add a compact `sideEffect` `Select` using the existing `Select` component. Options: an unset
sentinel (e.g. `"—"` mapping to `undefined`) plus `read` / `write` / `destructive`. Writing it back
sets `tool.sideEffect` on the draft (or deletes the key when unset). This lets a designer resolve an
inferred warning into a declared one (or silence a false positive).

### Presets (`packages/core/src/presets/`)

**No preset is changed.** Audited during planning, the existing presets' only digital tools are
`searchCatalog`, `act`, `executeSkill`, `submitAnswer`, `search`, `lookup`, `finish` — none match the
destructive-verb list and none are genuinely destructive, so fabricating a `"destructive"` tag would
misrepresent the archetype. Instead, `presets.test.ts` gains a regression assertion that **no preset
emits a `destructive-tool-safety` finding** (proving the heuristic does not mis-fire on the canonical
agents). The feature is demonstrated entirely by the `lint.test.ts` cases below. Presets continue to
lint **error-free**.

### Tests (`packages/core/src/__tests__/lint.test.ts`)

Add cases (cloning `reactAgent` via the existing `mutate` helper):
- An untagged tool named `delete_record` → findings include `destructive-tool-safety` (heuristic).
- A tool tagged `sideEffect: "destructive"` → findings include `destructive-tool-safety` (declared).
- A tool tagged `sideEffect: "read"` with an innocuous name → does **not** include the rule.
- (Regression) `lintAgent(reactAgent).ok` stays `true`.

### Out of scope

- **Inference assembler** (`packages/inference`) is unchanged — untagged inferred tools are covered
  by the heuristic at lint time; auto-tagging at assembly is a possible later enhancement.
- **Export bundles** need no change — `sideEffect` serializes into `blueprint.json` automatically.

---

## Feature 2 — "Why?" paper-quote popovers

### Content (`apps/web/lib/coala-glossary.ts`)

A pure-data module: `Record<string, { quote: string; cite: string }>` keyed by concept id, with
~20 **verbatim** quotes extracted from `2309.02427v3.pdf`. Coverage:

| Group | Concept ids |
|-------|-------------|
| Sections (4) | `memory`, `access`, `grounding`, `decision` |
| Memory kinds (4) | `working`, `episodic`, `semantic`, `procedural` |
| Retrieval methods (5) | `recency`, `importance`, `relevance`, `embedding`, `rule` |
| Learning ops (3) | `learning-add`, `learning-modify`, `learning-delete` |
| Grounding types (3) | `dialogue`, `physical`, `digital` |
| Decision sub-stages (3) | `proposal`, `evaluation`, `selection` |

`cite` is a short section reference (e.g. `"§4.1"`) matching the style already used in linter
messages. Quotes are kept short (one or two sentences) and lifted accurately from the paper.

### Component (`apps/web/components/why.tsx`)

`<Why id="working" />`:
- Renders a subtle `(?)` button (small, slate, hover → indigo — matches `IconBtn` styling).
- Click toggles a small absolutely-positioned popover card showing the quote (italic) + the `cite`
  reference (mono, dimmed). Click-outside / Esc closes it.
- Accessible: real `<button>`, `aria-label={`Why: ${id}`}`, `aria-expanded`.
- No new npm dependency — `useState` + a click-outside `useEffect`, Tailwind only.
- If `id` is missing from the glossary, render nothing (defensive — keeps wiring forgiving).

### Wiring (`apps/web/components/board.tsx`)

- `Section` gains an optional `whyId?: string` prop; when present it renders `<Why id={whyId} />`
  beside the `title`. Apply to the four section headers (`memory`, `access`, `grounding`,
  `decision`).
- Add `<Why>` instances at the finer-grained controls: memory-kind module headers, retrieval-method
  selector, learning add/modify/delete checkboxes, grounding-type select, and the decision
  proposal/evaluation/selection toggles.

Always visible (no Advanced gating) — inline teaching is the feature's purpose.

### Verification

1. `npm run -w @coala/core test` — new linter cases pass; presets still parse + lint error-free.
2. Full `npm test` — total rises from 70 to ~71+ green.
3. Web (Node ≥18.17, `export PATH="/usr/local/opt/node@22/bin:$PATH"`): rebuild packages in order
   (`core → providers → {inference,export,runtime} → web`), then `npm run -w @coala/web build`
   (typecheck + `next build`) green.
4. Visual smoke (Playwright or manual): a destructive tool shows an amber `destructive-tool-safety`
   warning in the Findings panel; a `(?)` popover opens with a quote and closes on outside-click.

---

## Build order

1. Feature 1 in `@coala/core` (schema → linter → tests), rebuild core.
2. Feature 1 board editor (`sideEffect` select).
3. Feature 2 glossary content (extract quotes from the PDF).
4. Feature 2 `Why` component + board wiring.
5. Full verification pass.
