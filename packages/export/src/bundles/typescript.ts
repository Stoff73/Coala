import type { Agent } from "@coala/core";
import {
  type GeneratedFile,
  type LanguageEmitter,
  blueprintJson,
} from "./types.js";

/** True if any grounding interface delegates its tools to an MCP server. */
function hasMcp(agent: Agent): boolean {
  return agent.groundingInterfaces.some((g) => g.type === "digital" && !!g.mcp);
}

/** Digital tools that need a hand-written stub (i.e. NOT provided by an MCP server). */
function stubTools(agent: Agent): { name: string; description: string }[] {
  return agent.groundingInterfaces
    .filter((g) => g.type === "digital" && !g.mcp)
    .flatMap((g) => g.digitalTools.map((t) => ({ name: t.name, description: t.description })));
}

/** Embedded runtime — plain ESM JavaScript (.mjs), zero deps, runs on Node ≥18. */
const JS_RUNTIME = `// CoALA agent runtime (embedded, generated) — zero deps, Node >= 18 (uses global fetch).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LONG_TERM = ["episodic", "semantic", "procedural"];
const tokens = (s) => (String(s).toLowerCase().match(/[a-z0-9]+/g) || []);

class Store {
  constructor(seed = []) { this.records = [...seed]; }
  add(r) { this.records.push(r); }
  retrieve(text, method, k) {
    if (method === "recency") return this.records.slice(-k).reverse();
    if (method === "importance")
      return [...this.records].sort((a, b) => Number(b.importance || 0) - Number(a.importance || 0)).slice(0, k);
    if (method === "relevance" || method === "embedding") {
      const q = new Set(tokens(text));
      return [...this.records]
        .map((r) => ({ r, s: tokens(JSON.stringify(r)).filter((t) => q.has(t)).length }))
        .filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, k).map((x) => x.r);
    }
    return this.records.slice(0, k);
  }
}

export class CoalaAgent {
  constructor(blueprint, tools = {}, completer = null) {
    this.bp = blueprint; this.tools = tools; this.completer = completer;
    this.working = {}; this.stores = {};
    for (const m of blueprint.memoryModules)
      if (LONG_TERM.includes(m.kind))
        this.stores[m.id] = new Store((m.records || []).map((r) => r.data || {}));
  }

  async _complete(system, user) {
    if (this.completer) return await this.completer(system, user);
    const pc = this.bp.providerConfig;
    if (pc.provider === "anthropic") {
      const key = process.env.ANTHROPIC_API_KEY;
      if (!key) throw new Error("Set ANTHROPIC_API_KEY");
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: pc.model, max_tokens: 1024, system, messages: [{ role: "user", content: user }] }),
      });
      const data = await res.json();
      return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    }
    const bases = { openai: "https://api.openai.com/v1", xai: "https://api.x.ai/v1", ollama: "http://localhost:11434/v1" };
    const base = process.env.LLM_BASE_URL || bases[pc.provider] || "https://api.openai.com/v1";
    const key = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || "";
    const headers = { "content-type": "application/json" };
    if (key) headers.authorization = "Bearer " + key;
    const res = await fetch(base + "/chat/completions", {
      method: "POST", headers,
      body: JSON.stringify({ model: pc.model, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    });
    const data = await res.json();
    return data.choices[0].message.content;
  }

  async _structured(system, user, attempts = 3) {
    const instr = system + '\\n\\nRespond ONLY with JSON: {"thought":"...","action":{"type":"grounding|learning|respond|finish","tool":"...","args":{},"memoryModuleId":"...","record":{},"message":"...","result":"..."}}';
    let last = "";
    for (let n = 0; n < attempts; n++) {
      const text = await this._complete(instr, last ? user + "\\nPrevious error: " + last : user);
      const m = text.match(/\\{[\\s\\S]*\\}/);
      try {
        const obj = JSON.parse(m ? m[0] : text);
        if (obj.action && typeof obj.action === "object" && obj.action.type) { obj.thought = obj.thought || ""; return obj; }
        last = "missing action.type";
      } catch (e) { last = String(e); }
    }
    throw new Error("LLM did not return valid action JSON: " + last);
  }

  _module(id) { return this.bp.memoryModules.find((m) => m.id === id); }

  _retrieve(query) {
    const out = [];
    for (const a of this.bp.accessPolicy) {
      if (!a.retrieval.enabled) continue;
      const m = this._module(a.memoryModuleId);
      if (!m || !this.stores[m.id]) continue;
      const rc = m.retrievalConfig || {};
      const method = a.retrieval.method || rc.method || "relevance";
      const k = rc.k || 5;
      out.push({ moduleId: m.id, moduleName: m.name, method, records: this.stores[m.id].retrieve(query, method, k) });
    }
    return out;
  }

  _targets() {
    const tools = this.bp.groundingInterfaces.filter((g) => g.type === "digital").flatMap((g) => g.digitalTools || []);
    const writable = this.bp.accessPolicy.filter((a) => a.learning.add).map((a) => this._module(a.memoryModuleId)).filter(Boolean);
    const dialogue = this.bp.groundingInterfaces.some((g) => g.type === "dialogue");
    return { tools, writable, dialogue };
  }

  _prompt(tools, writable, dialogue) {
    const toolLines = tools.length ? tools.map((t) => "  - " + t.name + ": " + (t.description || "")).join("\\n") : "  (none)";
    const writeLines = writable.length ? writable.map((m) => '  - id="' + m.id + '" (' + m.kind + ") " + m.name).join("\\n") : "  (none)";
    const system = [
      'You are the decision procedure of a CoALA agent named "' + this.bp.name + '".',
      "Goals: " + ((this.bp.goals || []).join("; ") || "(none)") + ".",
      "Each cycle: reason over working memory, then choose ONE next action.",
      "Action types: grounding(tool,args) | learning(memoryModuleId,record) | respond(message) | finish(result).",
      "Available tools:", toolLines, "Writable memory modules:", writeLines,
      dialogue ? "This agent can talk to the user; use respond to answer." : "Use finish to end.",
      "Do not invent tools or module ids.",
    ].join("\\n");
    const user = "Working memory:\\n" + JSON.stringify(this.working, null, 2) + "\\n\\nChoose the next action.";
    return { system, user };
  }

  _learn(mid, record) {
    if (!mid) return "No memoryModuleId provided.";
    const a = this.bp.accessPolicy.find((x) => x.memoryModuleId === mid);
    if (!a || !a.learning.add) return 'Module "' + mid + '" is not writable (no learning grant).';
    if (!this.stores[mid]) return 'Module "' + mid + '" has no store.';
    this.stores[mid].add(record);
    return { moduleId: mid, moduleName: this._module(mid).name, record };
  }

  async runTurn(message, maxSteps = 6) {
    this.working.input = message;
    const { tools, writable, dialogue } = this._targets();
    const steps = []; let reply = null;
    for (let i = 1; i <= maxSteps; i++) {
      const retrieved = this._retrieve(message);
      this.working.retrieved = retrieved;
      const { system, user } = this._prompt(tools, writable, dialogue);
      const proposal = await this._structured(system, user);
      const action = proposal.action;
      const step = { step: i, retrieved, thought: proposal.thought || "", action, terminal: false };
      if (action.type === "respond") { reply = action.message || ""; step.terminal = true; }
      else if (action.type === "finish") { reply = reply ?? action.result ?? null; step.terminal = true; }
      else if (action.type === "grounding") {
        const fn = this.tools[action.tool];
        const obs = fn ? await fn(action.args || {}, this.working) : { unhandled: true, tool: action.tool };
        step.observation = obs; this.working.lastObservation = obs;
      } else if (action.type === "learning") {
        const w = this._learn(action.memoryModuleId, action.record || {});
        if (typeof w === "string") step.blocked = w; else step.memoryWrite = w;
      }
      steps.push(step);
      if (step.terminal) break;
    }
    return { reply, steps };
  }
}

export function loadAgent({ blueprintPath, tools = {}, completer = null } = {}) {
  const p = blueprintPath || path.join(path.dirname(fileURLToPath(import.meta.url)), "blueprint.json");
  return new CoalaAgent(JSON.parse(fs.readFileSync(p, "utf8")), tools, completer);
}
`;

function toolsMjs(agent: Agent): string {
  const tools = stubTools(agent);
  const entries = tools
    .map(
      (t) => `  // ${t.description || t.name}
  ${JSON.stringify(t.name)}: async (args, ctx) => {
    // TODO: implement against your app (DB, API, etc.) and return an observation.
    throw new Error("Implement the '${t.name}' tool");
  },`,
    )
    .join("\n");
  return `// Grounding tools you implement by hand (MCP-backed tools are wired in mcp.mjs).
export const TOOLS = {
${entries || "  // (all tools are provided by MCP, or none declared)"}
};
`;
}

/** MCP client glue — connects to the servers declared in blueprint.json. */
const MCP_MJS = `// Connects to the MCP servers declared on the agent's grounding interfaces
// and exposes their tools as handlers. Requires @modelcontextprotocol/sdk.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

function parseResult(res) {
  const parts = (res.content || []).map((c) => {
    if (c.type === "text") { try { return JSON.parse(c.text); } catch { return c.text; } }
    return c;
  });
  return parts.length === 1 ? parts[0] : parts;
}

/** Returns { tools, close } — tools is a name->handler map; call close() to disconnect. */
export async function connectMcpTools(blueprint) {
  const tools = {};
  const clients = [];
  for (const g of blueprint.groundingInterfaces) {
    if (g.type !== "digital" || !g.mcp) continue;
    const mcp = g.mcp;
    const transport = mcp.transport === "stdio"
      ? new StdioClientTransport({ command: mcp.command, args: mcp.args || [], env: { ...process.env, ...(mcp.env || {}) } })
      : new StreamableHTTPClientTransport(new URL(mcp.url));
    const client = new Client({ name: "coala-agent", version: "1.0.0" }, { capabilities: {} });
    await client.connect(transport);
    clients.push(client);
    const listed = await client.listTools();
    const names = (g.digitalTools && g.digitalTools.length) ? g.digitalTools.map((t) => t.name) : listed.tools.map((t) => t.name);
    for (const name of names) tools[name] = async (args) => parseResult(await client.callTool({ name, arguments: args }));
  }
  return { tools, close: async () => { for (const c of clients) await c.close().catch(() => {}); } };
}
`;

function runMjs(mcp: boolean): string {
  if (!mcp) {
    return `// CLI: node run.mjs "your message"
import { loadAgent } from "./agent.mjs";
import { TOOLS } from "./tools.mjs";

const message = process.argv.slice(2).join(" ") || "Hello";
const agent = loadAgent({ tools: TOOLS });
console.log(JSON.stringify(await agent.runTurn(message), null, 2));
`;
  }
  return `// CLI: node run.mjs "your message"
import { readFileSync } from "node:fs";
import { loadAgent } from "./agent.mjs";
import { TOOLS } from "./tools.mjs";
import { connectMcpTools } from "./mcp.mjs";

const blueprint = JSON.parse(readFileSync(new URL("./blueprint.json", import.meta.url)));
const message = process.argv.slice(2).join(" ") || "Hello";
const { tools: mcpTools, close } = await connectMcpTools(blueprint);
const agent = loadAgent({ tools: { ...TOOLS, ...mcpTools } });
console.log(JSON.stringify(await agent.runTurn(message), null, 2));
await close();
process.exit(0);
`;
}

function serverMjs(mcp: boolean): string {
  const setup = mcp
    ? `import { readFileSync } from "node:fs";
import { connectMcpTools } from "./mcp.mjs";
const blueprint = JSON.parse(readFileSync(new URL("./blueprint.json", import.meta.url)));
const { tools: mcpTools } = await connectMcpTools(blueprint);
const agent = loadAgent({ tools: { ...TOOLS, ...mcpTools } });`
    : `const agent = loadAgent({ tools: TOOLS });`;
  return `// Zero-dep HTTP glue:  node server.mjs   (POST /chat {"message":"..."})
import http from "node:http";
import { loadAgent } from "./agent.mjs";
import { TOOLS } from "./tools.mjs";
${setup}

http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/chat") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const { message } = JSON.parse(body || "{}");
        const result = await agent.runTurn(String(message || ""));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    });
  } else {
    res.writeHead(404);
    res.end();
  }
}).listen(3000, () => console.log("Agent on http://localhost:3000/chat"));
`;
}

function packageJson(agent: Agent): string {
  const deps = hasMcp(agent) ? { "@modelcontextprotocol/sdk": "^1.0.0" } : undefined;
  return JSON.stringify(
    { name: "coala-agent", version: "1.0.0", private: true, type: "module", description: agent.name, ...(deps ? { dependencies: deps } : {}) },
    null,
    2,
  );
}

function envExample(agent: Agent): string {
  const p = agent.providerConfig.provider;
  const lines: Record<string, string> = {
    anthropic: "ANTHROPIC_API_KEY=",
    openai: "OPENAI_API_KEY=",
    xai: "OPENAI_API_KEY=\nLLM_BASE_URL=https://api.x.ai/v1",
    google: "OPENAI_API_KEY=   # Gemini not bundled; use openai/anthropic",
    ollama: "LLM_BASE_URL=http://localhost:11434/v1",
    local: "LLM_BASE_URL=\nLLM_API_KEY=",
  };
  return `# Provider key for ${p}.\n${lines[p] ?? "OPENAI_API_KEY="}\n`;
}

function readme(agent: Agent): string {
  return `# ${agent.name} — CoALA agent (TypeScript / Node)

Self-contained, runnable CoALA agent. Plain ESM JavaScript — drop into any Node/TS project.

## Layout
- \`agent.mjs\` — embedded CoALA runtime (zero deps, Node ≥18).
- \`blueprint.json\` — memory modules, schemas, seed records, access policy, decision procedure.
- \`tools.mjs\` — **implement your grounding tools here**.
- \`run.mjs\` — CLI.  \`server.mjs\` — zero-dep HTTP server.

## Run
\`\`\`bash
cp .env.example .env   # add your provider key
${hasMcp(agent) ? "npm install   # pulls @modelcontextprotocol/sdk for the MCP tools\n" : ""}node run.mjs "your message here"
# or: node server.mjs   →  POST http://localhost:3000/chat
\`\`\`
${hasMcp(agent) ? "\nThis agent's tools are backed by an **MCP server** (see `blueprint.json` → groundingInterfaces[].mcp).\n`mcp.mjs` connects to it and registers the tools automatically — no stubs to implement.\n" : ""}
TypeScript projects can \`import { loadAgent } from "./agent.mjs"\` directly.
Swap the in-memory \`Store\` in \`agent.mjs\` for your DB/vector store (same \`add\`/\`retrieve\` API).
`;
}

export const typescriptEmitter: LanguageEmitter = {
  id: "typescript",
  label: "TypeScript / Node",
  verified: true,
  files(agent: Agent): GeneratedFile[] {
    const mcp = hasMcp(agent);
    const files: GeneratedFile[] = [
      { path: "agent.mjs", content: JS_RUNTIME, language: "javascript" },
      { path: "blueprint.json", content: blueprintJson(agent), language: "json" },
      { path: "tools.mjs", content: toolsMjs(agent), language: "javascript" },
      { path: "run.mjs", content: runMjs(mcp), language: "javascript" },
      { path: "server.mjs", content: serverMjs(mcp), language: "javascript" },
      { path: "package.json", content: packageJson(agent), language: "json" },
      { path: ".env.example", content: envExample(agent), language: "text" },
      { path: "README.md", content: readme(agent), language: "markdown" },
    ];
    if (mcp) files.push({ path: "mcp.mjs", content: MCP_MJS, language: "javascript" });
    return files;
  },
};
