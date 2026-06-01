import { Agent } from "../schema/agent.js";
import { defaultProvider } from "./_shared.js";

/**
 * Retail Assistant — the worked example from CoALA §6.
 * Semantic memory of catalog items (read-only) + episodic memory of customer
 * interactions (read + write); dialogue + digital grounding; reason / retrieve / learn;
 * a Propose + Evaluate decision that checks results against inferred user intent.
 */
export const retailAssistantAgent: Agent = Agent.parse({
  id: "preset-retail-assistant",
  name: "Retail Assistant",
  naturalLanguageSpec:
    "A personalized shopping assistant that helps users find relevant items from the catalog based on their query and past purchases, returning search results via dialogue.",
  goals: [
    "Help users find relevant items",
    "Personalize results using purchase history",
  ],
  providerConfig: defaultProvider,
  memoryModules: [
    {
      id: "mem-working",
      kind: "working",
      name: "Dialogue state",
      description: "Tracks the conversation, inferred intent, and candidate results.",
      backingStore: { type: "kv" },
    },
    {
      id: "mem-procedural",
      kind: "procedural",
      name: "Agent code + LLM",
      description: "Query functions over the datastores plus intent and evaluation prompts.",
      backingStore: { type: "code" },
    },
    {
      id: "mem-catalog",
      kind: "semantic",
      name: "Product catalog",
      description: "The set of items available for sale. Read-only — the agent must not edit inventory.",
      schema: {
        title: "Product",
        fields: [
          { name: "name", type: "string", required: true },
          { name: "price", type: "number", required: true },
          { name: "tags", type: "json", required: false },
          { name: "embedding", type: "vector", required: false },
        ],
      },
      retrievalConfig: { method: "embedding", k: 8 },
      backingStore: { type: "pgvector" },
    },
    {
      id: "mem-history",
      kind: "episodic",
      name: "Customer interactions",
      description: "Each customer's previous purchases and past interactions.",
      schema: {
        title: "Interaction",
        fields: [
          { name: "customerId", type: "string", required: true },
          { name: "query", type: "string", required: false },
          { name: "purchased", type: "json", required: false },
          { name: "timestamp", type: "datetime", required: true },
        ],
      },
      retrievalConfig: { method: "recency", k: 10 },
      backingStore: { type: "pgvector" },
    },
  ],
  groundingInterfaces: [
    {
      id: "ground-dialogue",
      type: "dialogue",
      name: "Customer chat",
      description: "Return search results and converse with the user.",
    },
    {
      id: "ground-search",
      type: "digital",
      name: "Catalog search",
      description: "Query the product datastore.",
      digitalTools: [
        { name: "searchCatalog", description: "Search products by query and filters." },
      ],
    },
  ],
  accessPolicy: [
    {
      // Read-only: the agent should not update the inventory.
      memoryModuleId: "mem-catalog",
      retrieval: { enabled: true, method: "embedding" },
      learning: { add: false, modify: false, delete: false },
    },
    {
      // Read + write episodic: store new customer interactions as a form of learning.
      memoryModuleId: "mem-history",
      retrieval: { enabled: true, method: "recency" },
      learning: { add: true, modify: false, delete: false },
    },
  ],
  decisionProcedure: {
    style: "custom",
    planning: {
      proposal: {
        enabled: true,
        strategy: "Retrieve history to infer intent, then propose candidate search results.",
      },
      evaluation: {
        enabled: true,
        strategy: "Reason about whether the results satisfy the inferred user intent.",
      },
      selection: { enabled: false },
    },
    executionPolicy:
      "Return results via dialogue; at end of interaction, summarize and store the episode in episodic memory.",
  },
  metadata: { preset: "retail-assistant", version: 0 },
});
