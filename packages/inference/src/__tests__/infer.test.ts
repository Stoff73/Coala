import { describe, expect, it } from "vitest";
import type { ProviderConfig } from "@coala/core";
import { MockProvider, whenIncludes } from "@coala/providers";
import { inferBlueprint } from "../infer.js";

const providerConfig: ProviderConfig = { provider: "local", model: "test-model" };

const MEMORY_JSON = JSON.stringify({
  goals: ["Help users find relevant products", "Personalize using purchase history"],
  modules: [
    {
      kind: "semantic",
      name: "Product catalog",
      description: "Items available for sale.",
      rationale: "The agent needs product facts to search.",
      recordSchema: {
        title: "Product",
        fields: [
          { name: "name", type: "string", required: true },
          { name: "price", type: "number", required: true },
        ],
      },
    },
    {
      kind: "episodic",
      name: "Customer interactions",
      description: "Past purchases and queries per customer.",
      rationale: "Used to personalize results.",
      recordSchema: {
        title: "Interaction",
        fields: [
          { name: "customerId", type: "string", required: true },
          { name: "query", type: "string" },
        ],
      },
    },
  ],
});

const ACCESS_JSON = JSON.stringify({
  grants: [
    {
      moduleName: "Product catalog",
      read: true,
      retrievalMethod: "embedding",
      add: false,
      modify: false,
      delete: false,
      rationale: "Inventory is read-only.",
    },
    {
      moduleName: "Customer interactions",
      read: true,
      retrievalMethod: "recency",
      add: true,
      modify: false,
      delete: false,
      rationale: "Store new interactions as learning.",
    },
  ],
});

const DECISION_JSON = JSON.stringify({
  style: "custom",
  proposal: { enabled: true, strategy: "Infer intent, propose candidate results." },
  evaluation: { enabled: true, strategy: "Check results against inferred intent." },
  selection: { enabled: false },
  executionPolicy: "Return results via dialogue; store the episode at the end.",
  grounding: [
    { type: "dialogue", name: "Customer chat", description: "Converse with the user." },
    {
      type: "digital",
      name: "Catalog search",
      description: "Query the product datastore.",
      tools: [{ name: "searchCatalog", description: "Search products by query." }],
    },
  ],
});

function retailProvider() {
  return new MockProvider([
    { match: whenIncludes("memory pass"), text: MEMORY_JSON },
    { match: whenIncludes("access pass"), text: ACCESS_JSON },
    { match: whenIncludes("decision pass"), text: DECISION_JSON },
  ]);
}

describe("inferBlueprint (three-pass §6 engine)", () => {
  it("produces a lint-clean retail-assistant blueprint", async () => {
    const provider = retailProvider();
    const result = await inferBlueprint(
      {
        name: "Retail Assistant",
        naturalLanguageSpec:
          "Helps users find products from our catalog and remembers their past purchases.",
        providerConfig,
      },
      provider,
    );

    expect(provider.calls).toHaveLength(3);
    expect(result.ok).toBe(true);
    expect(result.findings.filter((f) => f.severity === "error")).toHaveLength(0);
  });

  it("auto-adds the CoALA-required working + procedural modules", async () => {
    const { agent } = await inferBlueprint(
      { name: "Retail Assistant", naturalLanguageSpec: "...", providerConfig },
      retailProvider(),
    );
    const kinds = agent.memoryModules.map((m) => m.kind).sort();
    expect(kinds).toEqual(["episodic", "procedural", "semantic", "working"]);
  });

  it("maps the internal action space correctly (read-only catalog, writable history)", async () => {
    const { agent } = await inferBlueprint(
      { name: "Retail Assistant", naturalLanguageSpec: "...", providerConfig },
      retailProvider(),
    );
    const byName = (n: string) => agent.memoryModules.find((m) => m.name === n)!;
    const grantFor = (id: string) =>
      agent.accessPolicy.find((g) => g.memoryModuleId === id)!;

    const catalog = grantFor(byName("Product catalog").id);
    expect(catalog.retrieval).toEqual({ enabled: true, method: "embedding" });
    expect(catalog.learning).toEqual({ add: false, modify: false, delete: false });

    const history = grantFor(byName("Customer interactions").id);
    expect(history.retrieval.method).toBe("recency");
    expect(history.learning.add).toBe(true);

    // Working memory gets no access grant.
    const working = byName("Working memory");
    expect(agent.accessPolicy.some((g) => g.memoryModuleId === working.id)).toBe(false);
  });

  it("builds the external action space (dialogue + digital tool)", async () => {
    const { agent } = await inferBlueprint(
      { name: "Retail Assistant", naturalLanguageSpec: "...", providerConfig },
      retailProvider(),
    );
    const types = agent.groundingInterfaces.map((g) => g.type).sort();
    expect(types).toEqual(["dialogue", "digital"]);
    const digital = agent.groundingInterfaces.find((g) => g.type === "digital")!;
    expect(digital.digitalTools.map((t) => t.name)).toContain("searchCatalog");
  });

  it("surfaces a grounding-required error when the model proposes no grounding", async () => {
    const provider = new MockProvider([
      { match: whenIncludes("memory pass"), text: MEMORY_JSON },
      { match: whenIncludes("access pass"), text: ACCESS_JSON },
      {
        match: whenIncludes("decision pass"),
        text: JSON.stringify({
          style: "react",
          proposal: { enabled: true },
          evaluation: { enabled: false },
          selection: { enabled: false },
          grounding: [],
        }),
      },
    ]);
    const result = await inferBlueprint(
      { name: "No Grounding", naturalLanguageSpec: "...", providerConfig },
      provider,
    );
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.rule)).toContain("grounding-required");
  });
});
