import { Agent } from "../schema/agent.js";
import { defaultProvider } from "./_shared.js";

/**
 * SayCan (Ahn et al. 2022) — Table 2.
 * Procedural long-term memory only (LLM + a learned value function); physical grounding;
 * no internal reasoning/retrieval/learning actions; decision = evaluate a fixed skill set.
 */
export const sayCanAgent: Agent = Agent.parse({
  id: "preset-saycan",
  name: "SayCan",
  naturalLanguageSpec:
    "A kitchen robot that satisfies a user request by scoring a fixed set of grounding skills, balancing each skill's usefulness (LLM) against its feasibility (learned value function).",
  goals: ["Carry out physical user requests using available robot skills"],
  providerConfig: defaultProvider,
  memoryModules: [
    {
      id: "mem-working",
      kind: "working",
      name: "Working memory",
      description: "Current instruction and selected skill sequence.",
      backingStore: { type: "kv" },
    },
    {
      id: "mem-procedural",
      kind: "procedural",
      name: "LLM + value function",
      description:
        "The LLM scores skill usefulness; a learned affordance value function scores feasibility. Fixed set of 551 skills.",
      backingStore: { type: "code" },
    },
  ],
  groundingInterfaces: [
    {
      id: "ground-robot",
      type: "physical",
      name: "Robot skills",
      description: "Fixed set of physical grounding skills (e.g. 'find the apple', 'go to the table').",
    },
  ],
  accessPolicy: [],
  decisionProcedure: {
    style: "saycan",
    planning: {
      proposal: { enabled: false },
      evaluation: {
        enabled: true,
        strategy: "Score each skill by LLM usefulness × learned feasibility value.",
      },
      selection: {
        enabled: true,
        strategy: "Pick the highest combined score as a single-step plan.",
      },
    },
    executionPolicy: "Execute the selected skill, then re-score for the next step.",
  },
  metadata: { preset: "saycan", version: 0 },
});
