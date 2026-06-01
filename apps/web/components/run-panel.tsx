"use client";

import { useState } from "react";
import type { Agent } from "@coala/core";
import type { CycleStep, TurnResult } from "@coala/runtime";

function ActionLabel({ step }: { step: CycleStep }) {
  const a = step.action;
  switch (a.type) {
    case "grounding":
      return <>🔧 grounding · <code>{a.tool}</code></>;
    case "learning":
      return <>💾 learning · write to <code>{a.memoryModuleId}</code></>;
    case "respond":
      return <>💬 respond</>;
    case "finish":
      return <>✅ finish</>;
  }
}

function StepCard({ step }: { step: CycleStep }) {
  const totalRetrieved = step.retrieved.reduce((n, r) => n + r.records.length, 0);
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-mono text-xs text-slate-500">cycle {step.step}</span>
        <span className="text-xs text-slate-300">
          <ActionLabel step={step} />
        </span>
      </div>

      {step.retrieved.length > 0 && (
        <div className="text-xs text-slate-500">
          retrieved {totalRetrieved} from {step.retrieved.map((r) => `${r.moduleName} (${r.method})`).join(", ")}
        </div>
      )}

      <div className="mt-1 italic text-slate-400">“{step.thought}”</div>

      {step.observation !== undefined && (
        <pre className="mt-2 overflow-auto rounded bg-slate-900 p-2 text-xs text-slate-300">
          obs: {JSON.stringify(step.observation)}
        </pre>
      )}
      {step.memoryWrite && (
        <div className="mt-2 text-xs text-emerald-400">
          wrote to {step.memoryWrite.moduleName}: {JSON.stringify(step.memoryWrite.record)}
        </div>
      )}
      {step.blocked && <div className="mt-2 text-xs text-amber-400">blocked: {step.blocked}</div>}
    </div>
  );
}

export function RunPanel({ agent }: { agent: Agent }) {
  const [message, setMessage] = useState("I'm looking for running shoes under $150.");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TurnResult | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent, message }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Run failed.");
        return;
      }
      setResult(data as TurnResult);
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex gap-2">
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !busy && run()}
          placeholder="Send the agent a message…"
          className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-indigo-500"
        />
        <button
          onClick={run}
          disabled={busy || !message.trim()}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {busy ? "Running…" : "Run turn"}
        </button>
      </div>

      <p className="mt-2 text-xs text-slate-500">
        Runs one decision cycle against {agent.providerConfig.provider}/{agent.providerConfig.model}.
        Grounding tools backed by an <strong>MCP server</strong> (set it on a grounding interface) execute
        for real; un-backed tools return a placeholder observation. Reasoning, retrieval, and memory
        writes are always real. (stdio MCP servers require <code>COALA_ALLOW_MCP_STDIO=1</code> on the server.)
      </p>

      {error && (
        <div className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-4 space-y-3">
          {result.reply !== null && (
            <div className="rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-4 py-2 text-sm text-indigo-100">
              {result.reply}
            </div>
          )}
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Decision cycle · {result.steps.length} step{result.steps.length === 1 ? "" : "s"}
          </div>
          <div className="space-y-2">
            {result.steps.map((s) => (
              <StepCard key={s.step} step={s} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
