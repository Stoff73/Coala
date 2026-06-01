# CoALA Agent Builder

A visual application for designing language agents on the **CoALA** framework
(*Cognitive Architectures for Language Agents*, Sumers et al., TMLR 2024 — `2309.02427v3.pdf`).

Users describe an agent in plain English; the app infers its CoALA structure
(memory modules, action space, decision procedure) and lets them CRUD every piece,
then exports a framework-neutral blueprint.

> **Full product & architecture plan: [`PLAN.md`](./PLAN.md).**

## Monorepo layout

```
packages/core        # ✅ the CoALA domain model (zod) + invariant linter + Table 2 presets
packages/providers   # ✅ model-agnostic LLM abstraction (Anthropic/OpenAI/xAI/Gemini/Ollama+local)
packages/inference   # ✅ NL spec → blueprint, the §6 three-pass engine
packages/export      # ✅ neutral blueprint + codegen + runnable-agent bundles (7 languages)
packages/runtime     # ✅ Phase 2 — executes the decision cycle (retrieve→reason→act)
apps/web             # ✅ Next.js app — editable board, accounts, workspaces, Run panel
```

## Requirements

- The **packages** build/test on Node ≥18.
- **`apps/web`** runs on Node ≥18.17 (Next.js 14). If your default `node` is older, launch the
  web app with a newer one (e.g. `nvm use 20`).

## Getting started

```bash
npm install
npm run build        # build packages in dependency order (core → providers → inference)
npm test             # run all package test suites (36 tests)
```

Run the designer UI:

```bash
cp apps/web/.env.example apps/web/.env   # DATABASE_URL is preset for SQLite; add an LLM key to infer
npm run -w @coala/web db:migrate         # create the local SQLite database (first run only)
npm run -w @coala/web dev                # http://localhost:3000  (Node ≥18.17)
```

> No API key needed to explore: the **Table 2 presets** load instantly via `/api/presets`.
> Generating a blueprint from a description calls the LLM and needs a key in `.env`.
> Persistence uses **SQLite** locally; for production, switch `prisma/schema.prisma`'s
> `provider` to `"postgresql"` and point `DATABASE_URL` at Postgres (no model changes).

> Build order matters: cross-package imports resolve through each package's `dist`,
> so `core` and `providers` must be built before `inference` typechecks/tests.

## Status

**Phase 1 in progress — the Designer.**
- `packages/core` — zod domain model, CoALA linter (PLAN §7), six Table 2 archetypes (PLAN §3) as passing fixtures.
- `packages/providers` — `LLMProvider` interface, generic zod structured-output (with retries), five adapters + factory, server-side env resolver, and a scriptable `MockProvider`.
- `packages/inference` — the §6 three-pass engine (Memory → Access → Decision) that turns a plain-English spec into a linted CoALA blueprint.
- `packages/export` — neutral `CoALA Blueprint` serializers (JSON · YAML · JSON Schema) + a codegen registry with TypeScript-stub and LangGraph(Python) adapters.
- `apps/web` — **editable** Blueprint Board (Memory cards · Access Matrix · Grounding · Decision · Goals), **live CoALA re-linting** on every edit, progressive-disclosure Advanced toggle, an Export bar (JSON/YAML/JSON-Schema/TypeScript/LangGraph).
- **Accounts & persistence (PLAN §6b)** — email+password auth (bcrypt + DB-backed httpOnly sessions), SQLite via Prisma (Postgres-portable), per-user/workspace **Blueprint CRUD** with **linear version history**, **share links** (view/edit), and a "My Blueprints" page.
- **Workspaces & teams** — create workspaces, **invite by email** (added immediately if registered, else a pending invite claimed on sign-up/-in), member management, and a workspace selector to save blueprints into a team.
- **`packages/runtime` (Phase 2)** — `AgentRuntime` executes the CoALA decision cycle (retrieve → reason/propose → execute) against any `LLMProvider`, a grounding-tool registry, and access-policy-enforced learning writes. The builder's **Run panel** runs a turn and visualizes each cycle (retrieval, reasoning, action, memory writes).
- **Real embedding retrieval** — the `"embedding"` retrieval method does genuine **cosine vector search** (`EmbeddingIndex`), not keyword overlap. `@coala/providers` ships an `EmbeddingProvider` — OpenAI (`text-embedding-3-*`) when a key is present, else a deterministic **local** embedder (feature-hashed bag-of-tokens+trigrams) so it works offline. `/api/run` wires it automatically. (Same ranking semantics as a pgvector query; swap the in-memory index for pgvector in production.)
- **Deep memory editing** — the board edits each memory kind fully: **semantic** (schema fields + seed records, always available), **procedural** (prompt **templates** + **skills** with code), and **episodic** (create/edit an **episode rubric** — scoring criteria + reflection prompts). Edited rubric/procedural content flows into the memory scaffold export.
- **Runnable-agent export** — the board's Export bar generates a **complete, self-contained drop-in project** in your language: an embedded CoALA runtime (decision cycle + memory stores + provider client), your \`blueprint.json\`, tool-handler stubs, framework glue, and a README — downloaded as a \`.zip\`. Implement the tool stubs, run it. Languages: **Python, TypeScript/Node, PHP, Go, Ruby, Java** (each execution-verified) and **C# / .NET** (generated, marked *preview* — not run-tested in CI). Each runtime reads keys from env and uses in-memory stores you can swap for your own DB/vector store (same \`add\`/\`retrieve\` API).
- **Diff-on-reinfer** — re-running inference never silently overwrites edits. With unsaved changes, a
  **diff panel** (memory/access/grounding/decision/goals added·removed·changed) offers **Merge** (adopt
  the new structure, keep your records, added modules/tools, and title), **Replace**, or **Keep mine**.
- **Memory scaffolds** — export a documented \`memory/\` directory tree (`scaffoldMemory`): per-module
  markdown docs, an **episode rubric template** per episodic store (record + trajectory + reflection +
  0–5 scoring), and **procedural prompt + skill templates**. Available as a standalone "Memory scaffold"
  download and bundled into every runnable-agent \`.zip\`.
- **Tool execution — host-supplied & MCP** — grounding tools can run for real, not just as stubs. Every language's exported runtime takes a **host-supplied tool registry** (name → handler). A grounding interface can also be **backed by an MCP server** (stdio or streamable-HTTP, declared in the board's Grounding section): the **in-UI Run panel** and the **exported Python & TypeScript** bundles auto-connect to it and dispatch tool calls to the server — no stubs to write. (stdio MCP spawns a subprocess; gated behind \`COALA_ALLOW_MCP_STDIO=1\` server-side.) The runtime's MCP client is verified against a real stdio MCP server end-to-end.

**Next:** real grounding-tool execution (host-supplied handlers / MCP), retrieval backed by pgvector, and richer multi-turn run sessions.
