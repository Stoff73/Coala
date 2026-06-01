import { Agent } from "../schema/agent.js";
import { defaultProvider } from "./_shared.js";

/**
 * ReAct (Yao et al. 2022b) — Table 2.
 * No long-term memory; digital grounding; a single reasoning action; propose-only decision.
 * The simplest agent that uses both internal (reason) and external (act) actions.
 */
export const reactAgent: Agent = Agent.parse({
  id: "preset-react",
  name: "ReAct",
  naturalLanguageSpec:
    "Interleave reasoning traces and actions to solve tasks against a digital environment (e.g. a Wikipedia API).",
  goals: ["Answer questions by reasoning and acting in a tool environment"],
  providerConfig: defaultProvider,
  memoryModules: [
    {
      id: "mem-working",
      kind: "working",
      name: "Working memory",
      description: "Current thought/action/observation trace for the task.",
      backingStore: { type: "kv" },
    },
    {
      id: "mem-procedural",
      kind: "procedural",
      name: "Agent code + LLM",
      description: "ReAct prompt template and parser; the LLM reasons and emits actions.",
      backingStore: { type: "code" },
    },
  ],
  groundingInterfaces: [
    {
      id: "ground-digital",
      type: "digital",
      name: "Tool environment",
      description: "Digital actions such as search/lookup against an external API.",
      digitalTools: [
        { name: "search", description: "Search the knowledge source for an entity." },
        { name: "lookup", description: "Look up a keyword in the current context." },
        { name: "finish", description: "Submit the final answer." },
      ],
    },
  ],
  accessPolicy: [],
  decisionProcedure: {
    style: "react",
    planning: {
      proposal: { enabled: true, strategy: "Single reasoning step proposes the next action." },
      evaluation: { enabled: false },
      selection: { enabled: false },
    },
    executionPolicy: "Execute the proposed action, observe, then loop.",
  },
  metadata: { preset: "react", version: 0 },
});
