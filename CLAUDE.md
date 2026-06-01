# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A visual application for **designing, testing, and exporting language agents on the CoALA framework**
(*Cognitive Architectures for Language Agents*, Sumers et al., TMLR 2024 — the source paper is
`2309.02427v3.pdf` in the repo root; `PLAN.md` is the full product/architecture plan). A user describes
an agent in plain English; the app infers its CoALA structure (memory modules, action space, decision
procedure), lets them CRUD it with live validation, run it against an LLM, and export it as a runnable
agent in several languages.

## Session continuity (do this first / last)

This repo carries state between sessions via two project-local skills under `.claude/skills/`:

- **At the START of a session** — if `*/*/handover-session-*.md` files exist (dated `{month}/{month}{day}/`
  folders, e.g. `june/june01/`), use the **session-start** skill: read the newest handover and the `.md`
  files it lists, then orient before doing anything. A `SessionStart` hook surfaces the latest handover
  path automatically, but you must still read it. Don't re-explore the repo when a handover already
  curated the entry points.
- **When WRAPPING UP** a session (user says "wrap up / end session / about to /clear / hand off", or a
  substantial block of work is clearly done) — use the **session-handover** skill: write a dated handover
  (what was done · what's left · next steps · key files · which `.md` files to load first) so the next
  session resumes cleanly. Don't use it for commit messages or mid-task notes.

These are "the model can just do it" tasks, so they under-trigger by description alone in headless runs —
hence this explicit pointer. Invoke them deliberately at session boundaries.

## Toolchain gotchas (read first)

- **Node version:** the **packages** build/test on Node ≥18, but **`apps/web` needs Node ≥18.17**
  (Next.js 14). The default `node` on this machine is often **18.15**, which is too old for the web app.
  An interactive terminal usually resolves to a newer Node (e.g. Homebrew `node@22` at
  `/usr/local/opt/node@22/bin`); when running web or full builds from a script, prepend a compatible
  Node, e.g. `export PATH="/usr/local/opt/node@22/bin:$PATH"`. nvm `default` is set to 20.
- **npm workspaces, not pnpm.** `npm install` at the root links all packages.
- **Build order matters.** Cross-package imports resolve through each package's built `dist/` (the
  packages' `package.json` `types`/`main` point at `dist`). So `@coala/core`, then `@coala/providers`,
  then `@coala/inference`/`@coala/export`/`@coala/runtime` must be built before downstream packages or
  `apps/web` will typecheck/run. The dependency order is:
  `core → providers → {inference, export, runtime} → apps/web`.

## Common commands

```bash
npm install                         # root, links workspaces
npm run build                       # build all packages (use Node ≥18.17 if it touches web)
npm test                            # run every package's vitest suite
npm run typecheck                   # tsc --noEmit across workspaces

# single package
npm run -w @coala/core test
npm run -w @coala/core build
npm run -w @coala/runtime typecheck

# single test file / test name (vitest)
npm run -w @coala/runtime test -- src/__tests__/mcp.test.ts
npm run -w @coala/export test -- -t "LangGraph"

# web app (Node ≥18.17)
npm run -w @coala/web db:migrate    # first run: create the local SQLite DB
npm run -w @coala/web dev           # http://localhost:3000
npm run -w @coala/web build         # runs `prisma generate` then `next build`
```

Web env: copy `apps/web/.env.example` → `apps/web/.env`. `DATABASE_URL` is preset for SQLite; add an
LLM provider key (e.g. `ANTHROPIC_API_KEY`) to use inference / the Run panel. Presets load with no key.

## Architecture — the big picture

The system is a layered monorepo where **`@coala/core` is the single contract**. One zod-validated
`Agent` document (the "blueprint") flows through every layer; each package is a producer or consumer of
that same type, which is why "design now, run/export later" costs no rework.

- **`packages/core`** — the domain model. `Agent` = `memoryModules[]` (working/episodic/semantic/
  procedural) + `accessPolicy[]` (the internal action space; read=retrieval, add/modify/delete=learning)
  + `groundingInterfaces[]` (external action space, incl. optional MCP server config) +
  `decisionProcedure`. Also exports `lintAgent` (the CoALA invariant linter — encodes paper §4/§6
  guidance, e.g. procedural+working memory required, write access implies a learning action, safety
  warnings for procedural-writes/unlearning) and the **six Table 2 preset archetypes** (ReAct, Voyager,
  Generative Agents, Tree of Thoughts, SayCan, Retail Assistant). The presets double as the linter's
  test fixtures — they must all parse and lint clean.
- **`packages/providers`** — model-agnostic `LLMProvider` interface. Adapters (Anthropic, OpenAI-
  compatible covering openai/xai/ollama/local, Google) are fetch-based, no vendor SDKs. Structured
  output is **one generic path** (`completeStructuredVia`): ask for JSON against a zod schema, validate,
  re-ask with the error on failure — works uniformly across providers. `MockProvider` is the scriptable
  test double. Secrets are injected (`credentialsFromEnv`, server-only); never on the agent.
- **`packages/inference`** — the §6 three-pass engine (`inferBlueprint`): Memory → Access → Decision,
  each a structured LLM call, then an **assembler** maps the loose draft outputs into a canonical,
  validated `Agent` (auto-adds required working+procedural modules, defaults retrieval methods, refuses
  learning grants on working memory) and lints it. This is the "describe → we work out your memory
  modules" core.
- **`packages/runtime`** (Phase 2) — `AgentRuntime.runTurn()` executes the CoALA decision cycle
  (retrieve → reason/propose → execute) against an `LLMProvider`. In-memory `Store`s (recency/
  importance/relevance/embedding/rule retrieval), a `ToolRegistry`, and **access-policy-enforced**
  learning writes. `buildTools(agent)` populates the registry from MCP servers + host handlers; the
  MCP client (`mcp.ts`) supports stdio (gated by `allowStdio`) and streamable-HTTP transports.
- **`packages/export`** — turns a blueprint into artifacts. Three things: neutral serializers
  (`toBlueprintJSON`/`toBlueprintYAML`/`blueprintJsonSchema`), framework codegen adapters
  (`generateCode`: TypeScript stub, LangGraph), and **runnable-agent bundles** (`bundleAgent`,
  `listEmitters`) — complete self-contained projects per language under `src/bundles/`. Each emitter's
  runtime is a **static source string** (it reads `blueprint.json` as data at load); only tool stubs,
  glue, and README are generated per agent. Python/TS bundles auto-wire MCP tools when the agent
  declares an MCP server (gated to keep non-MCP bundles dependency-free).
- **`apps/web`** — Next.js 14 (App Router) designer UI. The **Blueprint Board** (`components/board.tsx`)
  is a two-way editable view of the `Agent` document with **live re-linting** (runs `lintAgent`
  client-side in a `useMemo` — the same function the server uses). Persistence is Prisma + **SQLite**
  (`prisma/schema.prisma`, Postgres-portable: the blueprint is stored as JSON *text*). Auth is
  email+password with bcrypt + DB-backed httpOnly sessions (`lib/auth.ts`, `lib/api.ts` request guards).
  API routes under `app/api/` (auth, blueprints CRUD + versions + share, workspaces + invites, infer,
  presets, run). All LLM/secret access is server-side only.

### Key cross-cutting principles

- **The blueprint is the source of truth, enforced at every boundary.** Every write path (persistence,
  inference, export, run) runs untrusted input through `parseAgent` (the core zod schema) before use.
- **"The diagram IS the data."** The board edits the `Agent` object directly; inference, the linter, and
  export all consume the same object, so there is no separate diagram/UI state to drift.
- **`presets` are executable spec.** They're authored as `Agent.parse({...})` so a schema change that
  drifts from the framework breaks a preset at import — tests go red.

## Conventions

- Packages are ESM (`"type": "module"`), `tsconfig.base.json` is strict with `verbatimModuleSyntax` and
  `NodeNext` resolution — use `import type` for type-only imports and `.js` extensions on relative imports.
- `apps/web/tsconfig.json` is standalone (Next.js-style, `moduleResolution: bundler`), it does **not**
  extend the base.
- Provider-agnostic structured output: when an LLM must return structured data, define a zod schema and
  use `provider.completeStructured(req, schema)` — don't hand-parse JSON.
- Verification expectation in this repo is **execution, not just compilation**: runtime/export work is
  validated by actually running generated agents (incl. a real stdio MCP subprocess and multi-language
  bundles) with `MockProvider`/scripted completers, not only type-checking.
