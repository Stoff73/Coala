import { Agent } from "../schema/agent.js";
import { defaultProvider } from "./_shared.js";

/**
 * Generative Agents (Park et al. 2023) — Table 2.
 * Episodic + semantic long-term memory; digital + dialogue grounding;
 * reason / retrieve / learn; propose-only decision. Reflects over episodic memory
 * and writes the resulting inferences into semantic memory.
 */
export const generativeAgentsAgent: Agent = Agent.parse({
  id: "preset-generative-agents",
  name: "Generative Agents",
  naturalLanguageSpec:
    "A believable sandbox character that remembers events, reflects on them to form higher-level insights, and plans its day while interacting with other agents.",
  goals: ["Behave believably", "Form and act on reflections about itself and others"],
  providerConfig: defaultProvider,
  memoryModules: [
    {
      id: "mem-working",
      kind: "working",
      name: "Working memory",
      description: "Current plan, situation, and active observations.",
      backingStore: { type: "kv" },
    },
    {
      id: "mem-procedural",
      kind: "procedural",
      name: "Agent code + LLM",
      description: "Prompt templates for retrieval scoring, reflection, and planning.",
      backingStore: { type: "code" },
    },
    {
      id: "mem-episodic",
      kind: "episodic",
      name: "Memory stream",
      description: "Time-stamped stream of observed events and past behaviour.",
      schema: {
        title: "Event",
        fields: [
          { name: "description", type: "string", required: true },
          { name: "timestamp", type: "datetime", required: true },
          { name: "importance", type: "number", required: false },
        ],
      },
      retrievalConfig: { method: "relevance", k: 10 },
      backingStore: { type: "pgvector" },
    },
    {
      id: "mem-semantic",
      kind: "semantic",
      name: "Reflections",
      description: "Higher-level inferences synthesised from episodic memory.",
      schema: {
        title: "Reflection",
        fields: [
          { name: "insight", type: "string", required: true },
          { name: "evidence", type: "json", required: false },
        ],
      },
      retrievalConfig: { method: "relevance", k: 5 },
      backingStore: { type: "pgvector" },
    },
  ],
  groundingInterfaces: [
    {
      id: "ground-world",
      type: "digital",
      name: "Sandbox world",
      description: "Move and act within the simulated environment.",
      digitalTools: [{ name: "act", description: "Perform an action in the world." }],
    },
    {
      id: "ground-dialogue",
      type: "dialogue",
      name: "Conversation",
      description: "Talk with other agents and humans.",
    },
  ],
  accessPolicy: [
    {
      memoryModuleId: "mem-episodic",
      retrieval: { enabled: true, method: "relevance" },
      learning: { add: true, modify: false, delete: false },
    },
    {
      memoryModuleId: "mem-semantic",
      retrieval: { enabled: true, method: "relevance" },
      learning: { add: true, modify: false, delete: false },
    },
  ],
  decisionProcedure: {
    style: "generative-agents",
    planning: {
      proposal: {
        enabled: true,
        strategy: "Retrieve relevant memories, reason to plan the day, adjust as observations arrive.",
      },
      evaluation: { enabled: false },
      selection: { enabled: false },
    },
    executionPolicy:
      "Execute plan steps; stream observations into episodic memory; periodically reflect into semantic memory.",
  },
  metadata: { preset: "generative-agents", version: 0 },
});
