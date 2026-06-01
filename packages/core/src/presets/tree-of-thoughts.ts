import { Agent } from "../schema/agent.js";
import { defaultProvider } from "./_shared.js";

/**
 * Tree of Thoughts (Yao et al. 2023) — Table 2.
 * No long-term memory; one external action (submit a final answer); reasoning only;
 * but a deliberate Propose → Evaluate → Select decision procedure over a search tree.
 */
export const treeOfThoughtsAgent: Agent = Agent.parse({
  id: "preset-tree-of-thoughts",
  name: "Tree of Thoughts",
  naturalLanguageSpec:
    "Solve a deliberate reasoning problem (e.g. game of 24, creative writing, crosswords) by exploring a tree of thoughts with lookahead and backtracking.",
  goals: ["Find a correct solution via deliberate search over reasoning steps"],
  providerConfig: defaultProvider,
  memoryModules: [
    {
      id: "mem-working",
      kind: "working",
      name: "Thought tree",
      description: "Frontier of partial solutions (thoughts) maintained during search.",
      backingStore: { type: "kv" },
    },
    {
      id: "mem-procedural",
      kind: "procedural",
      name: "Agent code + LLM",
      description: "Thought generator, state evaluator, and search controller (BFS/DFS).",
      backingStore: { type: "code" },
    },
  ],
  groundingInterfaces: [
    {
      id: "ground-submit",
      type: "digital",
      name: "Answer channel",
      description: "Single external action: submit the final solution.",
      digitalTools: [{ name: "submitAnswer", description: "Submit the final answer." }],
    },
  ],
  accessPolicy: [],
  decisionProcedure: {
    style: "tot",
    planning: {
      proposal: { enabled: true, strategy: "Generate candidate next thoughts." },
      evaluation: { enabled: true, strategy: "LLM values each thought/state." },
      selection: {
        enabled: true,
        strategy: "Keep the most promising thoughts; backtrack via tree search.",
      },
    },
    executionPolicy:
      "Iterate propose/evaluate/select over the tree until a complete solution is found, then submit.",
  },
  metadata: { preset: "tree-of-thoughts", version: 0 },
});
