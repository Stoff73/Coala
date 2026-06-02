"use client";

import type { Agent } from "@coala/core";
import { MEMORY_KIND_META } from "../../lib/types";
import type { HealthSummary, Concern } from "../../lib/health";
import type { Update } from "../board";

type Go = (screen: "memory" | "perceive" | "decision" | "act" | "test" | "export" | "board", moduleId?: string) => void;

function Dot({ on }: { on: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${on ? "bg-amber-400" : "bg-emerald-500"}`}
      aria-hidden
    />
  );
}

function Node({
  emoji,
  label,
  summary,
  attention,
  onClick,
}: {
  emoji: string;
  label: string;
  summary: string;
  attention: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="min-w-[130px] rounded-xl border border-slate-700 bg-slate-900/40 px-4 py-3 text-center hover:border-indigo-500"
    >
      <div className="text-2xl">{emoji}</div>
      <div className="mt-1 flex items-center justify-center gap-1.5 text-sm font-semibold text-slate-100">
        {label} <Dot on={attention} />
      </div>
      <div className="mt-0.5 text-xs text-slate-400">{summary}</div>
    </button>
  );
}

export function SystemMap({
  agent,
  update,
  health,
  navigate,
}: {
  agent: Agent;
  update: Update;
  health: HealthSummary;
  navigate: Go;
}) {
  const memCount = agent.memoryModules.length;
  const toolCount = agent.groundingInterfaces.reduce((n, g) => n + g.digitalTools.length, 0);
  const att = (c: Concern) => health.byConcern[c];

  return (
    <div className="space-y-6">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          value={agent.name}
          onChange={(e) => update((d) => void (d.name = e.target.value))}
          className="max-w-md rounded border border-transparent bg-transparent text-2xl font-bold text-slate-100 outline-none hover:border-slate-700 focus:border-indigo-500"
        />
        <span className="rounded-md border border-slate-700 px-2 py-1 font-mono text-xs text-slate-400">
          {agent.providerConfig.provider} · {agent.providerConfig.model}
        </span>
      </div>

      {/* health banner */}
      <div
        className={`rounded-xl border px-4 py-3 text-sm ${
          health.status === "ok"
            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
            : "border-amber-500/40 bg-amber-500/10 text-amber-200"
        }`}
      >
        <strong>{health.status === "ok" ? "✓ " : "⚠ "}{health.headline}</strong>
        {health.items.length > 0 && (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs opacity-90">
            {health.items.map((it, i) => (
              <li key={i}>{it.message}</li>
            ))}
          </ul>
        )}
      </div>

      {/* the loop */}
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Node emoji="👂" label="Perceive" summary="what it receives" attention={att("perceive")} onClick={() => navigate("perceive")} />
        <span className="opacity-40">→</span>
        <div className="rounded-xl border-2 border-indigo-500 bg-indigo-500/10 p-3 text-center">
          <button onClick={() => navigate("memory")} className="text-2xl">🧠</button>
          <div className="mt-1 flex items-center justify-center gap-1.5 text-sm font-semibold text-slate-100">
            Memory <Dot on={att("memory")} />
          </div>
          <div className="mt-2 flex flex-wrap justify-center gap-1">
            {agent.memoryModules.map((m) => (
              <button
                key={m.id}
                onClick={() => navigate("memory", m.id)}
                className="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300 hover:bg-indigo-600 hover:text-white"
              >
                {MEMORY_KIND_META[m.kind].label}
              </button>
            ))}
          </div>
        </div>
        <span className="opacity-40">→</span>
        <Node emoji="⚖️" label="Decide" summary="how it chooses" attention={att("decision")} onClick={() => navigate("decision")} />
        <span className="opacity-40">→</span>
        <Node emoji="🤚" label="Act" summary={`${toolCount} tool${toolCount === 1 ? "" : "s"}`} attention={att("act")} onClick={() => navigate("act")} />
      </div>
      <div className="text-center text-xs text-slate-500">↺ the loop repeats each turn · click any part to open it</div>

      {/* utilities */}
      <div className="flex flex-wrap justify-center gap-2 text-sm">
        <button onClick={() => navigate("test")} className="rounded border border-slate-700 px-3 py-1.5 text-slate-300 hover:border-indigo-500">▶ Try it</button>
        <button onClick={() => navigate("export")} className="rounded border border-slate-700 px-3 py-1.5 text-slate-300 hover:border-indigo-500">⬇ Export</button>
        <button onClick={() => navigate("board")} className="rounded border border-slate-700 px-3 py-1.5 text-slate-400 hover:border-indigo-500">⚙ Expert view</button>
      </div>
      {memCount === 0 && <p className="text-center text-xs text-slate-500">No memory yet — open Memory to add some.</p>}
    </div>
  );
}
