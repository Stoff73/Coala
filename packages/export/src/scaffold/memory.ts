import type { Agent, AccessGrant, MemoryModule } from "@coala/core";
import type { GeneratedFile } from "../codegen/types.js";
import { slug } from "../codegen/types.js";

/**
 * Generates a documented `memory/` directory tree for an agent: per-module markdown
 * docs, an episode rubric template for each episodic store, and prompt + skill
 * templates for procedural memory. The structure mirrors CoALA's memory taxonomy
 * so a developer can wire it to real storage and a reflection/eval loop.
 */
export function scaffoldMemory(agent: Agent): GeneratedFile[] {
  const files: GeneratedFile[] = [{ path: "memory/README.md", content: readme(agent), language: "markdown" }];

  for (const m of agent.memoryModules) {
    const grant = agent.accessPolicy.find((a) => a.memoryModuleId === m.id);
    const base = `memory/${m.kind}/${slug(m.name)}`;
    switch (m.kind) {
      case "working":
        files.push(md(`${base}.md`, workingDoc(m)));
        break;
      case "semantic":
        files.push(md(`${base}.md`, storeDoc(m, grant, "semantic")));
        break;
      case "episodic":
        files.push(md(`${base}.md`, storeDoc(m, grant, "episodic")));
        files.push(md(`${base}.rubric.md`, episodeRubric(m)));
        break;
      case "procedural": {
        files.push(md(`${base}.md`, proceduralDoc(agent, m)));
        for (const f of proceduralTemplates(agent, m, base)) files.push(f);
        break;
      }
    }
  }
  return files;
}

const md = (path: string, content: string): GeneratedFile => ({ path, content, language: "markdown" });

function accessCell(grant: AccessGrant | undefined): { read: string; add: string; mod: string; del: string } {
  return {
    read: grant?.retrieval.enabled ? (grant.retrieval.method ?? "yes") : "—",
    add: grant?.learning.add ? "✓" : "—",
    mod: grant?.learning.modify ? "✓" : "—",
    del: grant?.learning.delete ? "✓" : "—",
  };
}

function readme(agent: Agent): string {
  const rows = agent.memoryModules
    .map((m) => {
      const g = agent.accessPolicy.find((a) => a.memoryModuleId === m.id);
      const c = accessCell(g);
      const rc = m.retrievalConfig ? `${m.retrievalConfig.method}${m.retrievalConfig.k ? ` (k=${m.retrievalConfig.k})` : ""}` : "—";
      return `| ${m.name} | ${m.kind} | ${rc} | ${c.read} | ${c.add} | ${c.mod} | ${c.del} |`;
    })
    .join("\n");
  const p = agent.decisionProcedure.planning;
  const onoff = (b: boolean) => (b ? "on" : "off");

  return `# ${agent.name} — Memory Architecture

Generated from the CoALA blueprint. This directory documents the agent's memory:
**working** (short-term hub) and the long-term stores **episodic** / **semantic** / **procedural**.

## Modules
| Module | Kind | Retrieval | Read | Add | Modify | Delete |
|--------|------|-----------|------|-----|--------|--------|
${rows}

*Read = retrieval into working memory. Add/Modify/Delete = learning (writes to long-term memory).*

## Decision procedure
- **Style:** ${agent.decisionProcedure.style}
- **Planning:** Propose ${onoff(p.proposal.enabled)} · Evaluate ${onoff(p.evaluation.enabled)} · Select ${onoff(p.selection.enabled)}

## Layout
- \`working/\` — variables carried across the decision cycle.
- \`semantic/\` — facts/knowledge stores (schema + seed records).
- \`episodic/\` — experience stores (schema) + \`*.rubric.md\` episode templates.
- \`procedural/\` — prompt templates + skill definitions (how the agent acts).
`;
}

function workingDoc(m: MemoryModule): string {
  return `# ${m.name} (working memory)

${m.description || "Short-term hub holding active variables across one decision cycle."}

**Backing store:** ${m.backingStore.type}

Working memory is rebuilt each turn (it is not retrieved or written to as long-term memory).
Typical variables: \`input\`, \`retrieved\`, \`lastObservation\`, intermediate reasoning state.
`;
}

function schemaTable(m: MemoryModule): string {
  if (!m.schema || m.schema.fields.length === 0) return "_No record schema defined — add fields to structure stored records._";
  const rows = m.schema.fields
    .map((f) => `| ${f.name} | ${f.type} | ${f.required ? "yes" : "no"} | ${f.description ?? ""} |`)
    .join("\n");
  return `**Record:** \`${m.schema.title}\`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
${rows}`;
}

function recordsTable(m: MemoryModule): string {
  if (!m.schema || m.records.length === 0) return `_No seed records (${m.records.length})._`;
  const cols = m.schema.fields.map((f) => f.name);
  const header = `| ${cols.join(" | ")} |\n| ${cols.map(() => "---").join(" | ")} |`;
  const rows = m.records
    .map((r) => `| ${cols.map((c) => String((r.data as Record<string, unknown>)[c] ?? "")).join(" | ")} |`)
    .join("\n");
  return `### Seed records (${m.records.length})\n${header}\n${rows}`;
}

function storeDoc(m: MemoryModule, grant: AccessGrant | undefined, kind: "semantic" | "episodic"): string {
  const c = accessCell(grant);
  const blurb =
    kind === "semantic"
      ? "Stores **facts** about the world and the agent itself. Retrieved into working memory to ground reasoning."
      : "Stores **experiences** (trajectories of past decision cycles). Retrieved for few-shot guidance and reflection.";
  return `# ${m.name} (${kind} memory)

${m.description || blurb}

- **Backing store:** ${m.backingStore.type}
- **Retrieval:** ${m.retrievalConfig ? `${m.retrievalConfig.method}${m.retrievalConfig.k ? ` (k=${m.retrievalConfig.k})` : ""}` : "—"}
- **Access:** read=${c.read} · add=${c.add} · modify=${c.mod} · delete=${c.del}

## Schema
${schemaTable(m)}

${recordsTable(m)}
${kind === "episodic" ? "\n> Record each new episode with `*.rubric.md` in this folder, then store it here." : "\n> Seed from your datastore; the agent appends as it learns (if write access is granted)."}
`;
}

/** Episode recording + scoring rubric — the core of episodic memory hygiene. */
function episodeRubric(m: MemoryModule): string {
  const schemaFields = m.schema?.fields.length
    ? m.schema.fields.map((f) => `- **${f.name}** (${f.type}):`).join("\n")
    : "- **id:**\n- **timestamp:**\n- **goal:**\n- **context:**";

  return `# Episode rubric — ${m.name}

Template for recording and evaluating ONE episode (a full decision-cycle trajectory).
Completed episodes are stored in ${m.kind} memory and feed retrieval + reflection.

## 1. Episode record
${schemaFields}

## 2. Trajectory
| step | observation | action (type · tool/module) | result |
|------|-------------|------------------------------|--------|
| 1 |  |  |  |
| 2 |  |  |  |

## 3. Outcome
- **status:** success | partial | failure
- **final reply / result:**
- **summary (one line):**

## 4. Reflection → semantic-memory candidates
> Insights distilled here can be written to semantic memory (the CoALA "reflection" loop).
${reflectionLines(m)}

## 5. Rubric scores (0–5 each)
| Criterion | Score | Notes |
|-----------|:-----:|-------|
${criterionRows(m)}

**Overall: __ / ${(m.rubric?.criteria.length ?? 5) * 5}**  ·  **Keep as exemplar?** yes / no
`;
}

/** Scoring rows from the module's edited rubric, or sensible defaults. */
function criterionRows(m: MemoryModule): string {
  const criteria = m.rubric?.criteria.length
    ? m.rubric.criteria
    : [
        { name: "Goal achieved", description: "" },
        { name: "Efficiency", description: "few cycles, no wasted tools" },
        { name: "Tool-use correctness", description: "" },
        { name: "Memory hygiene", description: "right reads/writes, policy respected" },
        { name: "Faithfulness to user intent", description: "" },
      ];
  return criteria.map((c) => `| ${c.name}${c.description ? ` (${c.description})` : ""} |  |  |`).join("\n");
}

function reflectionLines(m: MemoryModule): string {
  const prompts = m.rubric?.reflectionPrompts.length
    ? m.rubric.reflectionPrompts
    : ["What worked?", "What to avoid next time?", "New facts learned?"];
  return prompts.map((p) => `- ${p}`).join("\n");
}

function proceduralDoc(agent: Agent, m: MemoryModule): string {
  return `# ${m.name} (procedural memory)

${m.description || "The agent's code: prompt templates, parsers, and reusable skills — *how* it acts."}

- **LLM:** ${agent.providerConfig.provider}/${agent.providerConfig.model}
- **Decision style:** ${agent.decisionProcedure.style}
- **Backing store:** ${m.backingStore.type}

## Structure
- \`${slug(m.name)}/prompts/\` — reasoning & planning prompt templates (one per enabled sub-stage).
- \`${slug(m.name)}/skills/\` — reusable skill definitions; copy \`SKILL_TEMPLATE.md\` per skill.

> ⚠️ Writing to procedural memory lets the agent edit its own behaviour — change templates and
> skills deliberately, and version them.
`;
}

function proceduralTemplates(agent: Agent, m: MemoryModule, _base: string): GeneratedFile[] {
  const root = `memory/procedural/${slug(m.name)}`;
  const out: GeneratedFile[] = [];

  // Prefer the user's edited procedural templates; else generate per enabled decision sub-stage.
  if (m.procedural?.templates.length) {
    for (const t of m.procedural.templates) {
      out.push(md(`${root}/prompts/${slug(t.name)}.md`, `# ${t.name}\n\n${t.content || "<!-- prompt template -->"}\n`));
    }
  } else {
    const p = agent.decisionProcedure.planning;
    const stages: Array<[string, { enabled: boolean; strategy?: string }]> = [
      ["proposal", p.proposal],
      ["evaluation", p.evaluation],
      ["selection", p.selection],
    ];
    for (const [name, stage] of stages) {
      if (stage.enabled) out.push(md(`${root}/prompts/${name}.md`, promptTemplate(agent, name, stage.strategy)));
    }
  }
  for (const t of agent.decisionProcedure.reasoningTemplates) {
    out.push(md(`${root}/prompts/${slug(t.name)}.md`, `# ${t.name}\n\n${t.template || "<!-- prompt template -->"}\n`));
  }

  // Prefer the user's edited skills; else emit the blank skill template.
  if (m.procedural?.skills.length) {
    for (const s of m.procedural.skills) {
      out.push(
        md(
          `${root}/skills/${slug(s.name)}.md`,
          `# Skill: ${s.name}\n\n${s.description || ""}\n\n## Implementation\n\`\`\`\n${s.code || "<!-- code / steps -->"}\n\`\`\`\n`,
        ),
      );
    }
  } else {
    out.push(md(`${root}/skills/SKILL_TEMPLATE.md`, skillTemplate()));
  }
  return out;
}

function promptTemplate(agent: Agent, stage: string, strategy?: string): string {
  return `# ${stage[0]!.toUpperCase()}${stage.slice(1)} prompt

> Strategy: ${strategy ?? "(define how this sub-stage works)"}

\`\`\`text
You are the decision procedure of the CoALA agent "${agent.name}".
Goals: ${(agent.goals.join("; ") || "(none)")}.

Working memory:
{{working_memory}}

Available tools:
{{tools}}

Writable memory modules:
{{writable_modules}}

Task: ${stageInstruction(stage)}
Return ONLY JSON: { "thought": "...", "action": { "type": "grounding|learning|respond|finish", ... } }
\`\`\`
`;
}

function stageInstruction(stage: string): string {
  switch (stage) {
    case "proposal":
      return "Reason over working memory and propose the single best next action.";
    case "evaluation":
      return "Score the proposed action(s) against the goal; reject and re-propose if inadequate.";
    case "selection":
      return "Select the highest-value action (or backtrack) to execute this cycle.";
    default:
      return "Decide the next action.";
  }
}

function skillTemplate(): string {
  return `# Skill: <name>

Copy this file per reusable skill the agent can call or learn (procedural memory).

- **name:** \`<camelCaseName>\`
- **description:** what it does, in one line.
- **preconditions:** what must be true before it runs (inventory, state, memory).
- **inputs:** argument schema (name: type — description).
- **outputs / observation:** what it returns into working memory.

## Implementation
\`\`\`
<!-- code, API call, or step list. May call simpler skills as sub-procedures (Voyager-style). -->
\`\`\`

## Tests
- given … then …
`;
}
