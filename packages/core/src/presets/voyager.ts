import { Agent } from "../schema/agent.js";
import { defaultProvider } from "./_shared.js";

/**
 * Voyager (Wang et al. 2023a) — Table 2.
 * Procedural long-term memory (a skill library); digital grounding (Minecraft API);
 * reason / retrieve / learn; propose-only decision. Learns by writing new code skills —
 * so it intentionally trips the procedural-write safety warning.
 */
export const voyagerAgent: Agent = Agent.parse({
  id: "preset-voyager",
  name: "Voyager",
  naturalLanguageSpec:
    "An embodied agent in Minecraft that builds a library of reusable code skills, retrieving and composing them to explore and master the tech tree.",
  goals: ["Explore the world", "Acquire and reuse skills to complete novel tasks"],
  providerConfig: defaultProvider,
  memoryModules: [
    {
      id: "mem-working",
      kind: "working",
      name: "Working memory",
      description: "Current objective, inventory state, and environment feedback.",
      backingStore: { type: "kv" },
    },
    {
      id: "mem-skills",
      kind: "procedural",
      name: "Skill library",
      description:
        "Library of code-based grounding procedures (skills) that can call each other as sub-procedures.",
      schema: {
        title: "Skill",
        fields: [
          { name: "name", type: "string", required: true },
          { name: "code", type: "string", required: true },
          { name: "description", type: "string", required: false },
        ],
      },
      retrievalConfig: { method: "embedding", k: 5 },
      backingStore: { type: "code" },
    },
  ],
  groundingInterfaces: [
    {
      id: "ground-minecraft",
      type: "digital",
      name: "Minecraft API",
      description: "Text-based control of the Minecraft environment via code execution.",
      digitalTools: [
        { name: "executeSkill", description: "Run a code skill in the environment." },
      ],
    },
  ],
  accessPolicy: [
    {
      memoryModuleId: "mem-skills",
      retrieval: { enabled: true, method: "embedding" },
      learning: { add: true, modify: true, delete: false },
    },
  ],
  decisionProcedure: {
    style: "react",
    planning: {
      proposal: {
        enabled: true,
        strategy:
          "Reason to propose the next task objective, then a code-based skill to accomplish it.",
      },
      evaluation: { enabled: false },
      selection: { enabled: false },
    },
    executionPolicy:
      "Execute the skill; reason over feedback; on success, learn (store) the skill, else refine and retry.",
  },
  metadata: { preset: "voyager", version: 0 },
});
