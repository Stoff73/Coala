# CoALA Agent Builder — Product & Architecture Plan

> A visual application for designing language agents on the **CoALA** framework
> (Sumers, Yao, Narasimhan, Griffiths — *Cognitive Architectures for Language Agents*, TMLR 2024).
> Users describe an agent in natural language; the app infers the CoALA structure
> (memory modules, action space, decision procedure) and lets them CRUD every piece.

---

## 0. Decisions locked in

| Decision | Choice |
|---|---|
| **Deliverable** | Phase 1 = visual **designer + blueprint exporter**. Architected so a **live runtime** bolts on as Phase 2 without rework. |
| **Audience** | **Both**, via *progressive disclosure*: natural-language entry by default; full CoALA controls in an "Advanced" layer. |
| **Stack** | **Next.js (App Router) + TypeScript**, Postgres (+ pgvector, reserved for Phase 2), Prisma. |
| **LLM** | **Model-agnostic**: a provider interface (Anthropic / OpenAI / local) selected per agent. The app's *own* inference also runs through it. |
| **Auth** | **Accounts + blueprint sharing** (multi-tenant). Blueprints are owned, shareable, and (later) collaboratively versioned. |
| **API keys** | **BYO-key via `.env`** (server-side, never shipped to the browser). Keys bind to a provider, selected per agent. |
| **Procedural depth** | **Both** — inference drafts prompt templates / skills first; users edit them in-app as needed. |
| **Export** | **Neutral core + adapters**: canonical framework-neutral `CoALA Blueprint` (JSON + JSON Schema + YAML) is the source of truth; pluggable codegen emits portable TS stubs, then LangGraph, then others. |

---

## 1. Why CoALA maps cleanly onto a builder

CoALA describes **every** language agent with exactly three things (Fig. 4 & §4):

1. **Memory modules** — *Working* (short-term hub) + three long-term stores:
   - **Episodic** — past experiences / trajectories (what happened).
   - **Semantic** — facts about the world & self (what is true).
   - **Procedural** — the LLM weights (implicit) + agent code: prompt templates, parsers, skills (how to act).
2. **Action space** (§4.2–4.5, Fig. 5):
   - **External / Grounding** — dialogue, physical, digital (APIs/tools).
   - **Internal** — *Retrieval* (read LTM→working), *Reasoning* (read+write working), *Learning* (write LTM).
3. **Decision procedure** (§4.6) — a loop: **Planning** (Propose → Evaluate → Select) then **Execution**.

**§6 is, almost verbatim, a UI wizard spec.** The retail-assistant walkthrough prescribes three design steps, which become our happy path:

> **(a)** Determine which **memory modules** are necessary →
> **(b)** Define **read/write access** to each module (the internal action space) →
> **(c)** Define the **decision procedure** (how reasoning/retrieval pick a grounding or learning action).

So the product is: **describe → infer the three steps → present as editable cards → CRUD.**

---

## 2. Domain model (the CoALA-faithful data model)

This is the spine of the whole app. Two levels of CRUD the user explicitly asked for:
**module-level** (the memory *models*) and **record-level** (the *contents* inside each module).

```
Agent
 ├─ id, name, naturalLanguageSpec        # what the user typed
 ├─ goals[]                              # extracted objectives
 ├─ providerConfig                       # model-agnostic LLM binding (per agent)
 ├─ memoryModules[]      ── MemoryModule
 ├─ groundingInterfaces[] ─ GroundingInterface   # external action space
 ├─ accessPolicy[]       ── AccessGrant          # internal action space (per module)
 └─ decisionProcedure    ── DecisionProcedure

MemoryModule
 ├─ kind: working | episodic | semantic | procedural
 ├─ name, description, rationale          # why the inference engine added it
 ├─ schema: JSON Schema                   # the "model": fields/shape of one record
 │     • semantic  → entities & attributes (e.g. Product{name, price, tags})
 │     • episodic  → trajectory shape (e.g. {observation, action, result, ts})
 │     • procedural→ prompt templates, parsers, code-skills
 │     • working   → live variables carried across the decision cycle
 ├─ retrievalConfig: { method: recency|importance|relevance|embedding|rule, k }
 ├─ backingStore: { type: pgvector|kv|relational|inline }   # Phase 2 runtime; modeled now
 └─ records[]        ── MemoryRecord       # seed/CRUD data items

MemoryRecord
 ├─ data: JSON (validated against MemoryModule.schema)
 └─ source: seed | inferred | runtime

AccessGrant   # encodes §6 step (b) — e.g. episodic=read+write, semantic=read-only
 ├─ memoryModuleId
 ├─ retrieval: { enabled, method }                 # read  (Retrieval action)
 └─ learning:  { add, modify, delete }             # write (Learning action) — delete = "unlearning"

GroundingInterface     # external action space, §4.2
 ├─ type: dialogue | physical | digital
 └─ digitalTools[]: { name, description, schema }   # APIs / functions the agent may call

DecisionProcedure      # §4.6
 ├─ style: react | tot | reflexion | generative-agents | saycan | custom
 ├─ planning: { propose, evaluate, select } strategies
 ├─ reasoningTemplates[]
 └─ executionPolicy
```

> **Design note — the "memory model" vs "memory module" distinction the user raised:**
> a *module* is one store (Semantic memory). Its *schema* is the *model* (the shape of a Product
> record). Its *records* are the contents. The UI must let the user CRUD all three:
> add/remove modules, edit a module's schema, and add/edit/delete records inside it.

---

## 3. Starter archetypes (grounded in CoALA Table 2)

Ship preset blueprints straight from the paper so users start from a known-good shape and learn the framework by example:

| Preset | Long-term memory | Grounding | Internal actions | Decision |
|---|---|---|---|---|
| **ReAct** | none | digital | reason | propose |
| **Voyager** | procedural | digital | reason / retrieve / learn | propose |
| **Generative Agents** | episodic + semantic | digital / agent | reason / retrieve / learn | propose |
| **Tree of Thoughts** | none | digital (submit answer) | reason | propose / evaluate / select |
| **SayCan** | procedural | physical | — | evaluate |
| **Retail Assistant** (§6 worked example) | semantic + episodic | dialogue / digital | reason / retrieve / learn (episodic write-only) | propose + evaluate |

"Start blank" and "Start from a preset" are both entry points; presets are just pre-filled `Agent` rows.

---

## 4. Core user flow — the "describe → infer → CRUD" loop

```
┌─ 1. DESCRIBE ──────────────────────────────────────────────┐
│  User writes plain-English: "An assistant that helps users  │
│  find products from our catalog and remembers their past    │
│  purchases to personalize results."                         │
└────────────────────────────────────────────────────────────┘
                     │  (LLM structured-output inference, §6 three passes)
                     ▼
┌─ 2. INFER (the app "works out the memory modules") ─────────┐
│  Pass A — Memory:    Semantic{Product…} (read-only),         │
│                      Episodic{purchase, query…} (read+write),│
│                      Working{dialogue state}                 │
│  Pass B — Access:    semantic=read; episodic=read+write;     │
│                      procedural=read                         │
│  Pass C — Decision:  retrieve episodic → reason intent →     │
│                      propose results → evaluate vs intent    │
│  Each suggestion carries a one-line **rationale**.          │
└────────────────────────────────────────────────────────────┘
                     │
                     ▼
┌─ 3. REVIEW & CRUD ─────────────────────────────────────────┐
│  Editable cards per module + an access matrix + a decision  │
│  canvas. User can: add/remove modules, edit schemas, grant/ │
│  revoke read/write, add seed records, swap decision style.  │
│  "Advanced" toggle reveals raw CoALA terms & JSON Schema.   │
└────────────────────────────────────────────────────────────┘
                     │
                     ▼
┌─ 4. VALIDATE & EXPORT ─────────────────────────────────────┐
│  Lint against CoALA invariants (see §7). Export blueprint   │
│  JSON/YAML + scaffolded TS runtime stubs. (Phase 2: run it.)│
└────────────────────────────────────────────────────────────┘
```

---

## 5. UI / UX architecture (progressive disclosure)

Three primary surfaces, all reading the same `Agent` document:

1. **Describe panel** — chat-like NL input + "re-infer / refine" affordance. Beginners live here.
2. **Blueprint board** — the visual heart:
   - **Memory column** — a card per `MemoryModule` (icon-coded by kind). Card front = friendly summary; card back / "Advanced" = JSON Schema editor + retrieval config + records table (the record-level CRUD).
   - **Access matrix** — modules × {Read, Add, Modify, Delete} grid of toggles = the internal action space at a glance. Directly editable.
   - **Grounding tray** — chips for dialogue/physical/digital + a tool list.
   - **Decision canvas** — a small node diagram of Propose → Evaluate → Select → Execute; pick a style or wire custom.
3. **Inspector / Export drawer** — validation results, blueprint diff, export buttons.

**Progressive disclosure rule:** every CoALA technical term is hidden behind plain language by default, with an inline "Why?" popover (quoting the paper) and an Advanced switch that swaps friendly labels for the precise terms + raw schema editors. Same data, two vocabularies.

`★ Design principle ─ "the diagram IS the data" ─` The blueprint board is not a
picture of the agent — it is a direct, two-way editable view of the `Agent`
document. No separate "diagram state." This keeps inference, manual CRUD, and
export perfectly consistent and makes the Phase-2 runtime a pure consumer of the
same document.

---

## 6. Technical architecture

```
apps/web (Next.js App Router, TS)
 ├─ app/                     # routes: /agents, /agents/[id], /agents/[id]/board
 ├─ components/              # BlueprintBoard, MemoryCard, AccessMatrix, DecisionCanvas…
 └─ server/                 # Route Handlers / Server Actions

packages/core               # framework-agnostic, the reusable CoALA library (cf. §6 of paper:
 ├─ schema/                 #   "implement useful abstractions: Memory, Action, Agent classes")
 │    ├─ agent.ts           # zod schemas + TS types for the whole domain model (§2 above)
 │    ├─ memory.ts
 │    └─ coala-invariants.ts# the linter rules (§7)
 ├─ inference/              # NL spec → blueprint (the three §6 passes), provider-agnostic
 └─ export/                 # see §6a — neutral blueprint + pluggable codegen adapters

packages/providers          # model-agnostic LLM abstraction
 └─ LLMProvider interface { complete(), completeStructured(schema) }
      ├─ anthropic.ts  ├─ openai.ts  ├─ local.ts

packages/runtime  (PHASE 2) # executes the decision cycle against live memory stores
 ├─ decision-cycle.ts       # Propose→Evaluate→Select→Execute loop
 ├─ memory-stores/          # pgvector (semantic/episodic), kv (working), code (procedural)
 └─ grounding/              # dialogue, digital tool-callers

db: Postgres + Prisma  (pgvector extension reserved for Phase 2 retrieval)
```

### 6a. Export strategy — neutral core + adapters

Maximum flexibility comes from *not* binding to any one agent framework:

- **Canonical `CoALA Blueprint`** — the `Agent` document serialized as **JSON**, with a published
  **JSON Schema** (so it's a real interop contract) and a human-friendly **YAML** view. This is the
  source of truth, versioned and diffable. Any runtime, ours or third-party, consumes *this*.
- **Codegen adapters** transform the blueprint into runnable scaffolds. Adapter priority:
  1. **Portable TS runtime stubs** — zero external deps; the exact shape `packages/runtime` executes.
  2. **LangGraph (JS + Python)** — best structural fit: graph nodes/edges = the decision cycle,
     graph **state** = working memory, **store + checkpointer** = long-term memory.
  3. **Later:** LlamaIndex (retrieval/memory → semantic/episodic), generic OpenAI-tools agent.
- Adapters are pure functions `(Blueprint) → files`, registered in a small registry, so a new target
  never touches the core. (This directly realizes the paper's §6 call for a shared agent library.)

### 6b. Auth, tenancy & secrets

- **Accounts + sharing.** Postgres-backed auth (NextAuth/Auth.js). An `Agent`/blueprint belongs to a
  `User`/`Workspace`; share links + role grants (view/edit). The document model already supports
  versioning for later collaboration.
- **BYO-key via `.env`, server-side only.** Provider keys are read from server env / a server-side
  store and **never** reach the browser. All LLM calls (inference *and*, in Phase 2, agent execution)
  run through server Route Handlers. `providerConfig` on an agent names *which* provider/model; the
  secret itself stays server-side.

**Key architectural commitments**

- **`packages/core` is the contract.** The web app, the inference engine, the exporter, and the Phase-2 runtime all depend on the *same* zod-validated domain model. This is the single most important decision: it's what makes "design now, run later" cost-free.
- **LLM behind `LLMProvider`.** Inference (`packages/inference`) never imports a vendor SDK directly. The agent's own `providerConfig` and the app's inference can use different providers.
- **Structured-output inference.** Each §6 pass is a `completeStructured(zodSchema)` call so the model returns a validated `MemoryModule[]` / `AccessGrant[]` / `DecisionProcedure` — no fragile parsing.
- **Document-centric persistence.** An `Agent` is one JSON document (+ relational indexes for querying records). Versioned, diffable, exportable.

---

## 7. CoALA invariants — the validator/linter

Turn the paper's guidance into automated checks that keep blueprints sound and teach the framework:

- **Procedural memory must exist & be initialized** — every agent has at least the LLM + agent code (§4.1: "procedural memory must be initialized by the designer").
- **Working memory is mandatory** — it's the central hub connecting LLM, LTM, and grounding (§4.1).
- **Write access implies a learning action** — if a module is writable, a Learning action and a store must back it.
- **Read access implies a retrieval method** — granting Read requires choosing recency/importance/relevance/embedding/rule (§4.3).
- **Safety flags (§6 "safety of the action space")** — warn loudly on: procedural-memory *write/delete* (can rewrite the agent's own code), `delete` grants ("unlearning"), and destructive digital tools. Default these **off**.
- **Action-space vs decision-complexity tradeoff (§6)** — if the action space is large, nudge toward a structured decision procedure (evaluate/select), not bare propose.
- **Grounding required** — an agent with no external action space can't affect anything; require ≥1 grounding interface (or flag as pure-reasoning like ToT).

---

## 8. The inference engine in detail (§6 three-pass)

Each pass = one structured LLM call, chained, each editable before the next:

1. **Memory pass** → proposes `MemoryModule[]`. Prompt asks: *given this agent, which of
   episodic/semantic/procedural are needed, what does each store, and what is one record's schema?*
   Always seeds Working + Procedural.
2. **Access pass** → proposes `AccessGrant[]`. Prompt encodes the §6 retail logic:
   *should the agent be able to write here, or only read?* (e.g. inventory = read-only; customer
   interactions = read+write episodic).
3. **Decision pass** → proposes `DecisionProcedure` + `GroundingInterface[]`. Picks the simplest
   adequate style (ReAct) unless the task implies search/evaluation (→ ToT) or reflection
   (→ Generative-Agents), per the performance-vs-generalization tradeoff (§6).

A final **rationale layer** attaches a plain-English "why" to every node so the Review step is
self-explaining. Re-running inference produces a *diff* against the user's edits, never a silent overwrite.

---

## 9. Build roadmap

**Phase 0 — Foundations**
- `packages/core`: zod domain model + types + CoALA invariants. Unit-tested against the Table 2 archetypes (each preset must validate).
- `packages/providers`: `LLMProvider` interface + Anthropic & OpenAI adapters.

**Phase 1 — The Designer (the deliverable)**
- Next.js app shell, agents list, persistence (Prisma/Postgres).
- Blueprint board: Memory cards (module + schema + record CRUD), Access matrix, Grounding tray, Decision canvas.
- Inference engine (three passes) wired to the Describe panel, with rationale + diff-on-reinfer.
- Presets (Table 2 archetypes). Validator surfaced inline. Export (JSON/YAML + TS stubs).

**Phase 2 — The Runtime (bolt-on)**
- `packages/runtime`: decision-cycle executor + memory stores (pgvector for semantic/episodic, kv working, code procedural) + grounding tool-callers.
- "Run / chat with this agent" panel that visualizes live retrieval, reasoning, and memory writes during the decision cycle.
- Because everything consumes `packages/core`, no Phase-1 rework.

---

## 10. Resolved decisions & remaining open questions

**Resolved** (this round):
- **Tenancy** → accounts + blueprint sharing (multi-tenant), see §6b.
- **Secrets** → BYO-key via server-side `.env`, never in the browser, see §6b.
- **Procedural depth** → inference drafts templates/skills; users edit in-app.
- **Export** → neutral `CoALA Blueprint` + pluggable adapters (TS stubs → LangGraph → others), see §6a.

**Resolved** (this round):
- **Collaboration depth** → **linear version history** for v1 (no branching/merge yet).
- **Workspace model** → **both** personal accounts *and* Workspaces/Teams as the sharing boundary.
- **Providers at launch** → **Anthropic, OpenAI, xAI (Grok), Google Gemini, and local/Ollama** adapters.
- **Preset breadth** → ship **all six** Table 2 archetypes (§3) at launch.

All planning questions are now resolved. Phase-0 build (`packages/core`) is unblocked.

---

*Next step on approval: scaffold `packages/core` (the zod domain model + the Table 2 presets as
validation fixtures), since every other piece depends on it.*
