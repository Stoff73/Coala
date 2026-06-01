import type { Agent } from "@coala/core";
import { type CodegenAdapter, type GeneratedFile, pascal, slug } from "./types.js";

/**
 * Portable TypeScript runtime stub — zero external deps, the exact shape the
 * Phase-2 @coala/runtime will execute. Gives developers a skeleton to fill in.
 */
export const typescriptAdapter: CodegenAdapter = {
  id: "typescript",
  label: "TypeScript stub",
  generate(agent: Agent): GeneratedFile[] {
    const Name = pascal(agent.name);
    const ltm = agent.memoryModules.filter((m) => m.kind !== "working");
    const p = agent.decisionProcedure.planning;

    const storeFields = ltm
      .map((m) => {
        const grant = agent.accessPolicy.find((g) => g.memoryModuleId === m.id);
        const note = grant
          ? `read=${grant.retrieval.enabled ? (grant.retrieval.method ?? "yes") : "no"} ` +
            `write=${grant.learning.add || grant.learning.modify || grant.learning.delete}`
          : "no access";
        return `  /** ${m.kind} — ${note}. ${m.description} */\n  ${camel(m.name)}: MemoryStore;`;
      })
      .join("\n");

    const tools = agent.groundingInterfaces
      .flatMap((g) =>
        g.type === "digital"
          ? g.digitalTools.map(
              (t) => `  /** grounding: ${g.name}. ${t.description} */\n  async ${camel(t.name)}(args: unknown): Promise<unknown> {\n    throw new Error("TODO: implement ${t.name}");\n  }`,
            )
          : [`  // grounding: ${g.name} (${g.type}) — implement the ${g.type} interface.`],
      )
      .join("\n");

    const stages = [
      ["proposal", p.proposal] as const,
      ["evaluation", p.evaluation] as const,
      ["selection", p.selection] as const,
    ]
      .filter(([, s]) => s.enabled)
      .map(
        ([key, s]) =>
          `    // ${key}: ${s.strategy ?? "(define strategy)"}\n    // TODO: implement ${key} stage`,
      )
      .join("\n");

    const content = `// Generated from a CoALA Blueprint — "${agent.name}".
// A portable, dependency-free runtime skeleton. Fill in the TODOs.
// Style: ${agent.decisionProcedure.style} · Provider: ${agent.providerConfig.provider}/${agent.providerConfig.model}

import blueprint from "./${slug(agent.name)}.blueprint.json";

/** Working memory — the short-term hub carried across the decision cycle. */
export interface WorkingMemory {
  [key: string]: unknown;
}

/** Minimal long-term memory store interface (wire to your datastore). */
export interface MemoryStore {
  retrieve(query: string, k?: number): Promise<unknown[]>;
  add(record: unknown): Promise<void>;
}

export interface ${Name}Stores {
${storeFields || "  // (no long-term memory)"}
}

export class ${Name}Agent {
  constructor(
    private readonly llm: { complete(prompt: string): Promise<string> },
    private readonly memory: ${Name}Stores,
  ) {}

${tools || "  // (no grounding tools)"}

  /** One CoALA decision cycle: plan (propose/evaluate/select) then execute. */
  async decisionCycle(working: WorkingMemory): Promise<WorkingMemory> {
${stages || "    // TODO: implement planning stages"}
    // TODO: execute the selected grounding/learning action, then loop.
    return working;
  }

  static readonly blueprint = blueprint;
}
`;

    return [
      {
        path: `${slug(agent.name)}.agent.ts`,
        content,
        language: "typescript",
      },
      {
        path: `${slug(agent.name)}.blueprint.json`,
        content: JSON.stringify(agent, null, 2),
        language: "json",
      },
    ];
  },
};

function camel(s: string): string {
  const p = pascal(s);
  return p.charAt(0).toLowerCase() + p.slice(1);
}
