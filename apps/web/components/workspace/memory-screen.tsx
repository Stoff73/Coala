"use client";

import { useState } from "react";
import type { Agent } from "@coala/core";
import { MEMORY_KIND_META } from "../../lib/types";
import { applyGrant } from "../../lib/blueprint-edit";
import { ModuleEditor, type Update } from "../board";
import { Why } from "../why";
import { ScreenFrame } from "./screen-frame";

function Can({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-emerald-500" />
      {label}
    </label>
  );
}

export function MemoryScreen({
  agent,
  update,
  focusModuleId,
  onBack,
}: {
  agent: Agent;
  update: Update;
  focusModuleId?: string;
  onBack: () => void;
}) {
  const focusIdx = agent.memoryModules.findIndex((m) => m.id === focusModuleId);
  const [sel, setSel] = useState(focusIdx >= 0 ? focusIdx : 0);
  const idx = Math.min(sel, agent.memoryModules.length - 1);
  const m = agent.memoryModules[idx];

  if (!m) {
    return (
      <ScreenFrame breadcrumb="Overview · Memory" onBack={onBack}>
        <p className="text-sm text-slate-400">No memory systems yet.</p>
      </ScreenFrame>
    );
  }

  const grant = agent.accessPolicy.find((g) => g.memoryModuleId === m.id);
  const isWorking = m.kind === "working";

  return (
    <ScreenFrame breadcrumb="Overview · Memory" onBack={onBack}>
      <div className="flex flex-wrap gap-1 text-sm">
        {agent.memoryModules.map((mod, i) => (
          <button
            key={mod.id}
            onClick={() => setSel(i)}
            className={`rounded px-3 py-1 ${i === idx ? "bg-indigo-600 text-white" : "border border-slate-700 text-slate-300 hover:border-indigo-500"}`}
          >
            {MEMORY_KIND_META[mod.kind].label}
          </button>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <div className="flex items-center gap-1.5">
            <h3 className="text-lg font-semibold text-slate-100">{MEMORY_KIND_META[m.kind].label} memory</h3>
            <Why id={m.kind} />
          </div>
          <p className="mt-2 text-sm text-slate-400">{MEMORY_KIND_META[m.kind].plain}.</p>

          {isWorking ? (
            <p className="mt-4 text-xs text-slate-500">
              Working memory is the agent&apos;s scratchpad — it&apos;s always read and written during a turn, so there&apos;s nothing to grant here.
            </p>
          ) : (
            <div className="mt-4 space-y-1 rounded-lg border border-slate-800 p-3">
              <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">The agent can</div>
              <Can checked={!!grant?.retrieval.enabled} label="look things up (read)" onChange={(v) => applyGrant(update, m.id, (g) => void (g.retrieval.enabled = v))} />
              <Can checked={!!grant?.learning.add} label="add to it" onChange={(v) => applyGrant(update, m.id, (g) => void (g.learning.add = v))} />
              <Can checked={!!grant?.learning.modify} label="change it" onChange={(v) => applyGrant(update, m.id, (g) => void (g.learning.modify = v))} />
              <Can checked={!!grant?.learning.delete} label="remove from it" onChange={(v) => applyGrant(update, m.id, (g) => void (g.learning.delete = v))} />
            </div>
          )}
        </div>

        <ModuleEditor agent={agent} idx={idx} update={update} advanced={false} />
      </div>
    </ScreenFrame>
  );
}
