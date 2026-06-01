import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { retailAssistantAgent, type Agent } from "@coala/core";
import { MockProvider } from "@coala/providers";
import {
  AgentRuntime,
  ToolRegistry,
  WorkingMemory,
  buildTools,
  parseToolResult,
  registerMcpClient,
} from "../index.js";

function scripted(responses: string[]): MockProvider {
  let i = 0;
  return new MockProvider([
    { match: () => true, text: () => responses[Math.min(i++, responses.length - 1)]! },
  ]);
}

async function inMemoryClient(): Promise<Client> {
  const server = new Server({ name: "fixture", version: "1.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{ name: "searchCatalog", description: "", inputSchema: { type: "object" } }],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => ({
    content: [{ type: "text", text: JSON.stringify([{ name: "Trail Runner", q: req.params.arguments?.query }]) }],
  }));
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "c", version: "1.0.0" }, { capabilities: {} });
  await client.connect(clientT);
  return client;
}

const SEARCH_THEN_RESPOND = [
  JSON.stringify({ thought: "search", action: { type: "grounding", tool: "searchCatalog", args: { query: "running shoes" } } }),
  JSON.stringify({ thought: "done", action: { type: "respond", message: "ok" } }),
];

describe("parseToolResult", () => {
  it("unwraps JSON text content", () => {
    expect(parseToolResult({ content: [{ type: "text", text: '{"a":1}' }] })).toEqual({ a: 1 });
  });
  it("falls back to raw text", () => {
    expect(parseToolResult({ content: [{ type: "text", text: "hello" }] })).toBe("hello");
  });
});

describe("MCP tool execution (in-memory)", () => {
  it("dispatches a grounding call to an MCP server", async () => {
    const client = await inMemoryClient();
    const registry = new ToolRegistry();
    registerMcpClient(registry, client as never, ["searchCatalog"]);

    const runtime = new AgentRuntime(retailAssistantAgent, scripted(SEARCH_THEN_RESPOND), registry);
    const res = await runtime.runTurn("I need shoes");

    expect(res.steps[0]!.action.type).toBe("grounding");
    expect(res.steps[0]!.observation).toEqual([{ name: "Trail Runner", q: "running shoes" }]);
    await client.close();
  });
});

describe("host-supplied handlers", () => {
  it("buildTools registers host handlers (no MCP)", async () => {
    const { registry, close } = await buildTools(retailAssistantAgent, {
      hostHandlers: { searchCatalog: () => ["host-result"] },
    });
    expect(registry.has("searchCatalog")).toBe(true);
    const obs = await registry.run("searchCatalog", {}, { working: new WorkingMemory() });
    expect(obs).toEqual(["host-result"]);
    await close();
  });
});

describe("MCP tool execution (stdio subprocess)", () => {
  it("connects to a stdio MCP server and runs the tool through a full cycle", async () => {
    const fixture = fileURLToPath(new URL("./fixtures/mcp-stdio-server.mjs", import.meta.url));
    const agent: Agent = structuredClone(retailAssistantAgent);
    const digital = agent.groundingInterfaces.find((g) => g.type === "digital")!;
    digital.mcp = { transport: "stdio", command: "node", args: [fixture] };

    const { registry, close } = await buildTools(agent, { allowStdio: true });
    try {
      const runtime = new AgentRuntime(agent, scripted(SEARCH_THEN_RESPOND), registry);
      const res = await runtime.runTurn("I need shoes");
      expect(res.steps[0]!.observation).toEqual([{ name: "Trail Runner (mcp stdio)", q: "running shoes" }]);
    } finally {
      await close();
    }
  }, 20000);

  it("refuses stdio when not allowed", async () => {
    const agent: Agent = structuredClone(retailAssistantAgent);
    const digital = agent.groundingInterfaces.find((g) => g.type === "digital")!;
    digital.mcp = { transport: "stdio", command: "node", args: [] };
    await expect(buildTools(agent, { allowStdio: false })).rejects.toThrow(/stdio MCP transport is disabled/);
  });
});
