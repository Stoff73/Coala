import type { Agent, McpServer } from "@coala/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ToolRegistry, type ToolHandler } from "./tools.js";
import type { Record_ } from "./memory.js";

/** Minimal shape of an MCP client we depend on (so tests can inject one). */
export interface McpLike {
  listTools(): Promise<{ tools: Array<{ name: string }> }>;
  callTool(req: { name: string; arguments?: Record_ }): Promise<{
    content?: Array<{ type: string; text?: string }>;
    isError?: boolean;
  }>;
  close(): Promise<void>;
}

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Turn an MCP tool-call result into a plain observation. */
export function parseToolResult(res: {
  content?: Array<{ type: string; text?: string }>;
}): unknown {
  const parts = (res.content ?? []).map((c) =>
    c.type === "text" && c.text != null ? tryJson(c.text) : c,
  );
  if (parts.length === 0) return null;
  return parts.length === 1 ? parts[0] : parts;
}

/** A handler that dispatches a grounding tool call to an MCP server. */
export function mcpHandler(client: McpLike, toolName: string): ToolHandler {
  return async (args: Record_) => {
    const res = await client.callTool({ name: toolName, arguments: args });
    return parseToolResult(res);
  };
}

/** Register an already-connected MCP client's tools into a registry (unit-testable). */
export function registerMcpClient(
  registry: ToolRegistry,
  client: McpLike,
  toolNames: string[],
): void {
  for (const name of toolNames) registry.register(name, mcpHandler(client, name));
}

export interface ConnectOptions {
  /** stdio spawns a subprocess; gate it off in shared/multi-tenant deployments. */
  allowStdio?: boolean;
}

/** Connect to a configured MCP server and return the client + discovered tool names. */
export async function connectMcp(
  mcp: McpServer,
  opts: ConnectOptions = {},
): Promise<{ client: McpLike; toolNames: string[] }> {
  let transport;
  if (mcp.transport === "stdio") {
    if (!opts.allowStdio) {
      throw new Error("stdio MCP transport is disabled (set allowStdio to enable).");
    }
    if (!mcp.command) throw new Error("stdio MCP server requires a command.");
    transport = new StdioClientTransport({
      command: mcp.command,
      args: mcp.args ?? [],
      env: { ...(process.env as Record<string, string>), ...(mcp.env ?? {}) },
    });
  } else {
    if (!mcp.url) throw new Error("http MCP server requires a url.");
    transport = new StreamableHTTPClientTransport(new URL(mcp.url));
  }

  const client = new Client({ name: "coala-runtime", version: "0.0.0" }, { capabilities: {} });
  await client.connect(transport);
  const listed = await client.listTools();
  return { client: client as unknown as McpLike, toolNames: listed.tools.map((t) => t.name) };
}

export interface BuildToolsOptions extends ConnectOptions {
  /** Host-implemented handlers, overlaid on top of MCP-discovered tools. */
  hostHandlers?: Record<string, ToolHandler>;
}

export interface BuiltTools {
  registry: ToolRegistry;
  /** Disconnect every MCP server opened for this agent. */
  close(): Promise<void>;
}

/**
 * Build a {@link ToolRegistry} for an agent: connect to each grounding interface's
 * MCP server and register its tools, then overlay any host-supplied handlers.
 * Call `close()` when the turn(s) are done.
 */
export async function buildTools(agent: Agent, opts: BuildToolsOptions = {}): Promise<BuiltTools> {
  const registry = new ToolRegistry();
  const clients: McpLike[] = [];

  for (const g of agent.groundingInterfaces) {
    if (g.type !== "digital" || !g.mcp) continue;
    const { client, toolNames } = await connectMcp(g.mcp, { allowStdio: opts.allowStdio });
    clients.push(client);
    // Register the interface's declared tools (or everything the server offers).
    const names = g.digitalTools.length ? g.digitalTools.map((t) => t.name) : toolNames;
    registerMcpClient(registry, client, names);
  }

  for (const [name, fn] of Object.entries(opts.hostHandlers ?? {})) {
    registry.register(name, fn);
  }

  return {
    registry,
    close: async () => {
      for (const c of clients) await c.close().catch(() => undefined);
    },
  };
}
