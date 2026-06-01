import type { Agent } from "@coala/core";
import {
  type GeneratedFile,
  type LanguageEmitter,
  blueprintJson,
  snake,
} from "./types.js";

/**
 * The embedded CoALA runtime — static, stdlib-only Python. It reads blueprint.json
 * (memory modules, schemas, seed records, access policy) and executes the decision
 * cycle (retrieve → reason → act) against the agent's configured LLM provider.
 */
const PY_RUNTIME = `"""CoALA agent runtime (embedded, generated) — self-contained, Python stdlib only."""
import json, os, re, urllib.request

LONG_TERM = ("episodic", "semantic", "procedural")


def _tokens(s):
    return re.findall(r"[a-z0-9]+", str(s).lower())


class Store:
    """In-memory long-term store. Swap for your DB/vector store via the same API."""

    def __init__(self, seed=None):
        self.records = list(seed or [])

    def add(self, record):
        self.records.append(record)

    def retrieve(self, text, method, k):
        if method == "recency":
            return list(reversed(self.records[-k:]))
        if method == "importance":
            return sorted(self.records, key=lambda r: float(r.get("importance", 0) or 0), reverse=True)[:k]
        if method in ("relevance", "embedding"):
            q = set(_tokens(text))
            scored = []
            for r in self.records:
                s = sum(1 for t in _tokens(json.dumps(r)) if t in q)
                if s:
                    scored.append((s, r))
            scored.sort(key=lambda x: x[0], reverse=True)
            return [r for _, r in scored[:k]]
        return self.records[:k]  # rule


class CoalaAgent:
    def __init__(self, blueprint, tools=None):
        self.bp = blueprint
        self.tools = tools or {}
        self.working = {}
        self.stores = {}
        for m in blueprint["memoryModules"]:
            if m["kind"] in LONG_TERM:
                seed = [r.get("data", {}) for r in m.get("records", [])]
                self.stores[m["id"]] = Store(seed)

    # --- LLM provider (override _complete to use a different client) ---
    def _complete(self, system, user):
        pc = self.bp["providerConfig"]
        provider, model = pc["provider"], pc["model"]
        if provider == "anthropic":
            key = os.environ.get("ANTHROPIC_API_KEY")
            if not key:
                raise RuntimeError("Set ANTHROPIC_API_KEY")
            body = {"model": model, "max_tokens": 1024, "system": system,
                    "messages": [{"role": "user", "content": user}]}
            req = urllib.request.Request(
                "https://api.anthropic.com/v1/messages", data=json.dumps(body).encode(),
                headers={"content-type": "application/json", "x-api-key": key,
                         "anthropic-version": "2023-06-01"})
            data = json.loads(urllib.request.urlopen(req).read())
            return "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
        bases = {"openai": "https://api.openai.com/v1", "xai": "https://api.x.ai/v1",
                 "ollama": "http://localhost:11434/v1"}
        base = os.environ.get("LLM_BASE_URL") or bases.get(provider, "https://api.openai.com/v1")
        key = os.environ.get("OPENAI_API_KEY") or os.environ.get("LLM_API_KEY") or ""
        body = {"model": model, "messages": [
            {"role": "system", "content": system}, {"role": "user", "content": user}]}
        headers = {"content-type": "application/json"}
        if key:
            headers["authorization"] = "Bearer " + key
        req = urllib.request.Request(base + "/chat/completions", data=json.dumps(body).encode(), headers=headers)
        data = json.loads(urllib.request.urlopen(req).read())
        return data["choices"][0]["message"]["content"]

    def _structured(self, system, user, attempts=3):
        instr = system + '\\n\\nRespond ONLY with JSON: {"thought": "...", "action": {"type": "grounding|learning|respond|finish", "tool": "...", "args": {}, "memoryModuleId": "...", "record": {}, "message": "...", "result": "..."}}'
        last = ""
        for _ in range(attempts):
            text = self._complete(instr, user if not last else user + "\\nPrevious error: " + last)
            m = re.search(r"\\{.*\\}", text, re.S)
            try:
                obj = json.loads(m.group(0) if m else text)
                if isinstance(obj.get("action"), dict) and obj["action"].get("type"):
                    obj.setdefault("thought", "")
                    return obj
                last = "missing action.type"
            except Exception as e:  # noqa: BLE001
                last = str(e)
        raise RuntimeError("LLM did not return valid action JSON: " + last)

    def _module(self, mid):
        return next((m for m in self.bp["memoryModules"] if m["id"] == mid), None)

    def _retrieve(self, query):
        out = []
        for a in self.bp["accessPolicy"]:
            if not a["retrieval"]["enabled"]:
                continue
            m = self._module(a["memoryModuleId"])
            if not m or m["id"] not in self.stores:
                continue
            rc = m.get("retrievalConfig") or {}
            method = a["retrieval"].get("method") or rc.get("method") or "relevance"
            k = rc.get("k") or 5
            out.append({"moduleId": m["id"], "moduleName": m["name"], "method": method,
                        "records": self.stores[m["id"]].retrieve(query, method, k)})
        return out

    def _targets(self):
        tools = [t for g in self.bp["groundingInterfaces"] if g["type"] == "digital"
                 for t in g.get("digitalTools", [])]
        writable = [self._module(a["memoryModuleId"]) for a in self.bp["accessPolicy"] if a["learning"]["add"]]
        writable = [m for m in writable if m]
        dialogue = any(g["type"] == "dialogue" for g in self.bp["groundingInterfaces"])
        return tools, writable, dialogue

    def _prompt(self, tools, writable, dialogue):
        tool_lines = "\\n".join("  - %s: %s" % (t["name"], t.get("description", "")) for t in tools) or "  (none)"
        write_lines = "\\n".join('  - id="%s" (%s) %s' % (m["id"], m["kind"], m["name"]) for m in writable) or "  (none)"
        system = "\\n".join([
            'You are the decision procedure of a CoALA agent named "%s".' % self.bp["name"],
            "Goals: %s." % ("; ".join(self.bp.get("goals", [])) or "(none)"),
            "Each cycle: reason over working memory, then choose ONE next action.",
            "Action types: grounding(tool,args) | learning(memoryModuleId,record) | respond(message) | finish(result).",
            "Available tools:", tool_lines, "Writable memory modules:", write_lines,
            "This agent can talk to the user; use respond to answer." if dialogue else "Use finish to end.",
            "Do not invent tools or module ids.",
        ])
        user = "Working memory:\\n" + json.dumps(self.working, indent=2) + "\\n\\nChoose the next action."
        return system, user

    def _learn(self, mid, record):
        if not mid:
            return "No memoryModuleId provided."
        a = next((a for a in self.bp["accessPolicy"] if a["memoryModuleId"] == mid), None)
        if not a or not a["learning"]["add"]:
            return 'Module "%s" is not writable (no learning grant).' % mid
        if mid not in self.stores:
            return 'Module "%s" has no store.' % mid
        self.stores[mid].add(record)
        return {"moduleId": mid, "moduleName": self._module(mid)["name"], "record": record}

    def run_turn(self, message, max_steps=6):
        self.working["input"] = message
        tools, writable, dialogue = self._targets()
        steps, reply = [], None
        for i in range(1, max_steps + 1):
            retrieved = self._retrieve(message)
            self.working["retrieved"] = retrieved
            system, user = self._prompt(tools, writable, dialogue)
            proposal = self._structured(system, user)
            action = proposal["action"]
            t = action.get("type")
            step = {"step": i, "retrieved": retrieved, "thought": proposal.get("thought", ""),
                    "action": action, "terminal": False}
            if t == "respond":
                reply = action.get("message", "")
                step["terminal"] = True
            elif t == "finish":
                reply = reply if reply is not None else action.get("result")
                step["terminal"] = True
            elif t == "grounding":
                fn = self.tools.get(action.get("tool", ""))
                obs = fn(action.get("args", {}), self.working) if fn else {"unhandled": True, "tool": action.get("tool")}
                step["observation"] = obs
                self.working["lastObservation"] = obs
            elif t == "learning":
                w = self._learn(action.get("memoryModuleId"), action.get("record", {}))
                if isinstance(w, str):
                    step["blocked"] = w
                else:
                    step["memoryWrite"] = w
            steps.append(step)
            if step["terminal"]:
                break
        return {"reply": reply, "steps": steps}


def load_agent(blueprint_path=None, tools=None):
    path = blueprint_path or os.path.join(os.path.dirname(__file__), "blueprint.json")
    with open(path) as f:
        return CoalaAgent(json.load(f), tools)
`;

function hasMcp(agent: Agent): boolean {
  return agent.groundingInterfaces.some((g) => g.type === "digital" && !!g.mcp);
}

/** Digital tools needing a hand-written stub (NOT provided by an MCP server). */
function stubToolList(agent: Agent): { name: string; description: string }[] {
  return agent.groundingInterfaces
    .filter((g) => g.type === "digital" && !g.mcp)
    .flatMap((g) => g.digitalTools.map((t) => ({ name: t.name, description: t.description })));
}

function toolsPy(agent: Agent): string {
  const tools = stubToolList(agent);
  const fns = tools
    .map((t) => {
      const desc = t.description.replace(/"""/g, "'").trim() || t.name;
      return `def ${snake(t.name)}(args, ctx):
    """${desc}\n    args: dict of tool arguments. ctx: working memory dict."""
    # TODO: implement against your app (DB, API, etc.) and return an observation.
    raise NotImplementedError("Implement the '${t.name}' tool")`;
    })
    .join("\n\n");

  const registry = tools.map((t) => `    "${t.name}": ${snake(t.name)},`).join("\n");

  return `"""Grounding tools you implement by hand (MCP-backed tools are wired in mcp_tools.py)."""

${fns || "# (all tools are provided by MCP, or none declared)"}

TOOLS = {
${registry}
}
`;
}

/** Async↔sync bridge for the official `mcp` Python SDK (runs a loop in a thread). */
const MCP_PY = `"""Connects to the MCP servers declared in blueprint.json and exposes their tools.
Requires the official MCP SDK:  pip install mcp"""
import asyncio
import json
import threading
from contextlib import AsyncExitStack

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.client.streamable_http import streamablehttp_client


def _parse(result):
    parts = []
    for c in result.content:
        text = getattr(c, "text", None)
        if text is not None:
            try:
                parts.append(json.loads(text))
            except Exception:
                parts.append(text)
        else:
            parts.append(c)
    return parts[0] if len(parts) == 1 else parts


class McpTools:
    """Holds MCP sessions open on a background event loop and exposes sync handlers."""

    def __init__(self):
        self._loop = asyncio.new_event_loop()
        threading.Thread(target=self._loop.run_forever, daemon=True).start()
        self._stack = AsyncExitStack()

    def _run(self, coro):
        return asyncio.run_coroutine_threadsafe(coro, self._loop).result()

    def connect(self, blueprint):
        tools = {}
        for g in blueprint["groundingInterfaces"]:
            if g.get("type") != "digital" or not g.get("mcp"):
                continue
            session = self._run(self._open(g["mcp"]))
            listed = self._run(session.list_tools())
            names = [t["name"] for t in g.get("digitalTools", [])] or [t.name for t in listed.tools]
            for name in names:
                tools[name] = self._make(session, name)
        return tools

    async def _open(self, mcp):
        if mcp["transport"] == "stdio":
            params = StdioServerParameters(command=mcp["command"], args=mcp.get("args", []), env=mcp.get("env"))
            read, write = await self._stack.enter_async_context(stdio_client(params))
        else:
            read, write, _ = await self._stack.enter_async_context(streamablehttp_client(mcp["url"]))
        session = await self._stack.enter_async_context(ClientSession(read, write))
        await session.initialize()
        return session

    def _make(self, session, name):
        def handler(args, ctx):
            return _parse(self._run(session.call_tool(name, args)))
        return handler

    def close(self):
        try:
            self._run(self._stack.aclose())
        except Exception:
            pass
        self._loop.call_soon_threadsafe(self._loop.stop)
`;

function runPy(mcp: boolean): string {
  if (!mcp) {
    return `"""CLI: run one turn. Usage: python run.py "your message" """
import json, sys
from agent import load_agent
from tools import TOOLS

if __name__ == "__main__":
    message = " ".join(sys.argv[1:]) or "Hello"
    agent = load_agent(tools=TOOLS)
    print(json.dumps(agent.run_turn(message), indent=2))
`;
  }
  return `"""CLI: run one turn. Usage: python run.py "your message" """
import json, sys
from agent import load_agent
from tools import TOOLS
from mcp_tools import McpTools

if __name__ == "__main__":
    message = " ".join(sys.argv[1:]) or "Hello"
    blueprint = json.load(open("blueprint.json"))
    mcp = McpTools()
    tools = {**TOOLS, **mcp.connect(blueprint)}
    agent = load_agent(tools=tools)
    print(json.dumps(agent.run_turn(message), indent=2))
    mcp.close()
`;
}

function appPy(mcp: boolean): string {
  const setup = mcp
    ? `import json
_mcp = McpTools()
_tools = {**TOOLS, **_mcp.connect(json.load(open("blueprint.json")))}
agent = load_agent(tools=_tools)`
    : `agent = load_agent(tools=TOOLS)`;
  const mcpImport = mcp ? "\nfrom mcp_tools import McpTools" : "";
  return `"""FastAPI glue — serve the agent over HTTP.  uvicorn app:app --reload"""
from fastapi import FastAPI
from pydantic import BaseModel
from agent import load_agent
from tools import TOOLS${mcpImport}

app = FastAPI()
${setup}


class Message(BaseModel):
    message: str


@app.post("/chat")
def chat(body: Message):
    return agent.run_turn(body.message)
`;
}

function envExample(agent: Agent): string {
  const p = agent.providerConfig.provider;
  const lines: Record<string, string> = {
    anthropic: "ANTHROPIC_API_KEY=",
    openai: "OPENAI_API_KEY=",
    xai: "OPENAI_API_KEY=   # xAI uses an OpenAI-compatible key\nLLM_BASE_URL=https://api.x.ai/v1",
    google: "OPENAI_API_KEY=   # NOTE: Gemini support not bundled; set provider to openai/anthropic",
    ollama: "LLM_BASE_URL=http://localhost:11434/v1",
    local: "LLM_BASE_URL=\nLLM_API_KEY=",
  };
  return `# Provider key for ${p}. Read from the environment by the runtime.\n${lines[p] ?? "OPENAI_API_KEY="}\n`;
}

function readme(agent: Agent): string {
  return `# ${agent.name} — CoALA agent (Python)

A self-contained, runnable CoALA agent generated by the CoALA Agent Builder.

## Layout
- \`agent.py\` — the embedded CoALA runtime (stdlib only).
- \`blueprint.json\` — your agent's memory modules, schemas, seed records, access policy, decision procedure.
- \`tools.py\` — **implement your grounding tools here** (stubs are provided).
- \`run.py\` — CLI runner.  \`app.py\` — FastAPI HTTP glue.

## Run
\`\`\`bash
cp .env.example .env   # add your provider key
python run.py "your message here"
\`\`\`

## Serve (FastAPI)
\`\`\`bash
pip install fastapi uvicorn
uvicorn app:app --reload
# POST /chat  {"message": "..."}
\`\`\`

## Memory
Long-term memory uses in-memory stores seeded from \`blueprint.json\`. To persist,
replace the \`Store\` class in \`agent.py\` with your DB / vector store (same \`add\`/\`retrieve\` API).
`;
}

export const pythonEmitter: LanguageEmitter = {
  id: "python",
  label: "Python",
  verified: true,
  files(agent: Agent): GeneratedFile[] {
    const mcp = hasMcp(agent);
    const files: GeneratedFile[] = [
      { path: "agent.py", content: PY_RUNTIME, language: "python" },
      { path: "blueprint.json", content: blueprintJson(agent), language: "json" },
      { path: "tools.py", content: toolsPy(agent), language: "python" },
      { path: "run.py", content: runPy(mcp), language: "python" },
      { path: "app.py", content: appPy(mcp), language: "python" },
      { path: "requirements.txt", content: `fastapi\nuvicorn\n${mcp ? "mcp\n" : ""}`, language: "text" },
      { path: ".env.example", content: envExample(agent), language: "text" },
      { path: "README.md", content: readme(agent), language: "markdown" },
    ];
    if (mcp) files.push({ path: "mcp_tools.py", content: MCP_PY, language: "python" });
    return files;
  },
};
