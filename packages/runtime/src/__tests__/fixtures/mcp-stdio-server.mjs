// A minimal MCP server over stdio, used to verify the runtime's MCP client.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server({ name: "fixture", version: "1.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: "searchCatalog", description: "Search products", inputSchema: { type: "object" } }],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => ({
  content: [
    {
      type: "text",
      text: JSON.stringify([{ name: "Trail Runner (mcp stdio)", q: req.params.arguments?.query }]),
    },
  ],
}));

await server.connect(new StdioServerTransport());
