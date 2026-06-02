"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BackingStoreType,
  DecisionStyle,
  FieldType,
  GroundingType,
  MemoryKind,
  RetrievalMethod,
  lintAgent,
} from "@coala/core";
import type { Agent, MemoryModule } from "@coala/core";
import {
  blueprintJsonSchema,
  bundleAgent,
  generateCode,
  listAdapters,
  listEmitters,
  scaffoldMemory,
  toBlueprintJSON,
  toBlueprintYAML,
} from "@coala/export";
import JSZip from "jszip";
import { MEMORY_KIND_META, type BlueprintResult } from "../lib/types";
import { emptyGrant, newGrounding, newModule, newRubric } from "../lib/blueprint-edit";
import { RunPanel } from "./run-panel";
import { Why } from "./why";

export type Update = (fn: (draft: Agent) => void) => void;

/* ----------------------------- tiny inputs ------------------------------- */

function Input(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  className?: string;
}) {
  return (
    <input
      value={props.value}
      placeholder={props.placeholder}
      onChange={(e) => props.onChange(e.target.value)}
      className={`rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm outline-none focus:border-indigo-500 ${
        props.mono ? "font-mono" : ""
      } ${props.className ?? ""}`}
    />
  );
}

function Area(props: { value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <textarea
      value={props.value}
      rows={props.rows ?? 2}
      onChange={(e) => props.onChange(e.target.value)}
      className="w-full resize-y rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm outline-none focus:border-indigo-500"
    />
  );
}

function Select<T extends string>(props: {
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
}) {
  return (
    <select
      value={props.value}
      onChange={(e) => props.onChange(e.target.value as T)}
      className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm outline-none focus:border-indigo-500"
    >
      {props.options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function Check(props: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-slate-300">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
        className="accent-indigo-500"
      />
      {props.label}
    </label>
  );
}

function IconBtn(props: { onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button
      onClick={props.onClick}
      title={props.title}
      className="rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-300 hover:border-indigo-500 hover:text-indigo-300"
    >
      {props.children}
    </button>
  );
}

function Section({ title, hint, action, children, whyId }: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  whyId?: string;
}) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/30 p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-1.5 text-lg font-semibold text-slate-100">
            {title}
            {whyId && <Why id={whyId} />}
          </h3>
          {hint && <p className="text-xs text-slate-400">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/* ------------------------------- findings -------------------------------- */

const SEVERITY_CLS: Record<string, string> = {
  error: "border-red-500/40 bg-red-500/10 text-red-300",
  warning: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  info: "border-sky-500/40 bg-sky-500/10 text-sky-300",
};

function Findings({ agent }: { agent: Agent }) {
  const lint = useMemo(() => lintAgent(agent), [agent]);
  if (lint.findings.length === 0) {
    return (
      <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">
        ✓ Passes all CoALA invariants — no issues.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {lint.findings.map((f, i) => (
        <div key={i} className={`rounded-lg border px-4 py-2 text-sm ${SEVERITY_CLS[f.severity] ?? ""}`}>
          <span className="font-mono text-xs uppercase opacity-70">{f.severity}</span>{" "}
          <span className="font-medium">{f.rule}</span>
          <div className="mt-0.5 opacity-90">{f.message}</div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------- memory ---------------------------------- */

function MemorySection({ agent, update, advanced }: { agent: Agent; update: Update; advanced: boolean }) {
  return (
    <Section
      title="Memory modules"
      hint="Working + procedural are always present; add episodic & semantic as needed."
      whyId="memory"
      action={
        <div className="flex gap-1">
          {MemoryKind.options.map((k) => (
            <IconBtn key={k} title={`Add ${k}`} onClick={() => update((d) => d.memoryModules.push(newModule(k)))}>
              + {k}
            </IconBtn>
          ))}
        </div>
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
        {agent.memoryModules.map((m, idx) => (
          <ModuleEditor key={m.id} agent={agent} idx={idx} update={update} advanced={advanced} />
        ))}
      </div>
    </Section>
  );
}

/** Editor for a single memory module. Reused by the board (MemorySection) and the Memory screen. */
export function ModuleEditor({ agent, idx, update, advanced }: { agent: Agent; idx: number; update: Update; advanced: boolean }) {
  const m = agent.memoryModules[idx]!;
  const meta = MEMORY_KIND_META[m.kind];
  return (
    <div className={`rounded-xl border p-4 ${meta.cls}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <Select
          value={m.kind}
          options={MemoryKind.options}
          onChange={(kind) =>
            update((d) => {
              const mod = d.memoryModules[idx]!;
              mod.kind = kind;
              mod.backingStore.type =
                kind === "working" ? "kv" : kind === "procedural" ? "code" : "pgvector";
              if ((kind === "semantic" || kind === "episodic") && !mod.schema)
                mod.schema = { title: "Record", fields: [] };
            })
          }
        />
        <Why id={m.kind} />
        <IconBtn title="Delete module" onClick={() => update((d) => d.memoryModules.splice(idx, 1))}>
          ✕
        </IconBtn>
      </div>

      <Input
        value={m.name}
        onChange={(v) => update((d) => void (d.memoryModules[idx]!.name = v))}
        className="mb-2 w-full font-semibold"
        placeholder="Module name"
      />
      <Area value={m.description} onChange={(v) => update((d) => void (d.memoryModules[idx]!.description = v))} />

      {advanced && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <span>store</span>
          <Select
            value={m.backingStore.type}
            options={BackingStoreType.options}
            onChange={(v) => update((d) => void (d.memoryModules[idx]!.backingStore.type = v))}
          />
          {m.retrievalConfig && (
            <>
              <span>retrieval</span>
              <Select
                value={m.retrievalConfig.method}
                options={RetrievalMethod.options}
                onChange={(v) =>
                  update((d) => void (d.memoryModules[idx]!.retrievalConfig = { method: v }))
                }
              />
            </>
          )}
        </div>
      )}

      {/* schema editor (the "memory model") */}
      {m.schema && (
        <div className="mt-3 rounded-lg bg-slate-900/50 p-2">
          <div className="mb-1 flex items-center justify-between">
            <Input
              value={m.schema.title}
              onChange={(v) => update((d) => void (d.memoryModules[idx]!.schema!.title = v))}
              className="font-semibold"
            />
            <IconBtn
              title="Add field"
              onClick={() =>
                update((d) =>
                  d.memoryModules[idx]!.schema!.fields.push({ name: "field", type: "string", required: false }),
                )
              }
            >
              + field
            </IconBtn>
          </div>
          {m.schema.fields.map((f, fi) => (
            <div key={fi} className="mb-1 flex items-center gap-1">
              <Input
                value={f.name}
                onChange={(v) => update((d) => void (d.memoryModules[idx]!.schema!.fields[fi]!.name = v))}
                className="flex-1"
              />
              <Select
                value={f.type}
                options={FieldType.options}
                onChange={(v) => update((d) => void (d.memoryModules[idx]!.schema!.fields[fi]!.type = v))}
              />
              <Check
                checked={!!f.required}
                onChange={(v) => update((d) => void (d.memoryModules[idx]!.schema!.fields[fi]!.required = v))}
                label="req"
              />
              <IconBtn title="Remove field" onClick={() => update((d) => d.memoryModules[idx]!.schema!.fields.splice(fi, 1))}>
                ✕
              </IconBtn>
            </div>
          ))}

          {/* records editor — always available (semantic/episodic seed data) */}
          {(
            <div className="mt-2 border-t border-slate-800 pt-2">
              <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
                <span>records ({m.records.length})</span>
                <IconBtn title="Add record" onClick={() => update((d) => d.memoryModules[idx]!.records.push({ id: `rec-${Date.now().toString(36)}`, data: {}, source: "seed" }))}>
                  + record
                </IconBtn>
              </div>
              {m.records.map((rec, ri) => (
                <div key={rec.id} className="mb-1 flex flex-wrap items-center gap-1">
                  {m.schema!.fields.map((f) => (
                    <Input
                      key={f.name}
                      value={rec.data[f.name] != null ? String(rec.data[f.name]) : ""}
                      placeholder={f.name}
                      onChange={(v) =>
                        update((d) => {
                          d.memoryModules[idx]!.records[ri]!.data[f.name] =
                            f.type === "number" && v !== "" ? Number(v) : v;
                        })
                      }
                      className="w-28"
                    />
                  ))}
                  <IconBtn title="Remove record" onClick={() => update((d) => d.memoryModules[idx]!.records.splice(ri, 1))}>
                    ✕
                  </IconBtn>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* procedural editor — prompt templates + skills */}
      {m.kind === "procedural" && <ProceduralEditor module={m} idx={idx} update={update} />}

      {/* episodic rubric editor — create + edit scoring/reflection */}
      {m.kind === "episodic" && <RubricEditor module={m} idx={idx} update={update} />}

      {advanced && (
        <Input
          value={m.rationale ?? ""}
          onChange={(v) => update((d) => void (d.memoryModules[idx]!.rationale = v))}
          placeholder="rationale (why this module?)"
          className="mt-2 w-full text-xs italic"
        />
      )}
    </div>
  );
}

function ProceduralEditor({ module: m, idx, update }: { module: MemoryModule; idx: number; update: Update }) {
  const ensure = (d: Agent) => (d.memoryModules[idx]!.procedural ??= { templates: [], skills: [] });
  return (
    <div className="mt-3 rounded-lg bg-slate-900/50 p-2">
      <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
        <span>prompt templates ({m.procedural?.templates.length ?? 0})</span>
        <IconBtn title="Add template" onClick={() => update((d) => ensure(d).templates.push({ name: "template", content: "" }))}>
          + template
        </IconBtn>
      </div>
      {(m.procedural?.templates ?? []).map((t, ti) => (
        <div key={ti} className="mb-2">
          <div className="flex items-center gap-1">
            <Input value={t.name} mono className="flex-1" onChange={(v) => update((d) => void (ensure(d).templates[ti]!.name = v))} />
            <IconBtn title="Remove" onClick={() => update((d) => ensure(d).templates.splice(ti, 1))}>✕</IconBtn>
          </div>
          <Area value={t.content} rows={3} onChange={(v) => update((d) => void (ensure(d).templates[ti]!.content = v))} />
        </div>
      ))}

      <div className="mt-2 mb-1 flex items-center justify-between text-xs text-slate-400">
        <span>skills ({m.procedural?.skills.length ?? 0})</span>
        <IconBtn title="Add skill" onClick={() => update((d) => ensure(d).skills.push({ name: "skill", description: "", code: "" }))}>
          + skill
        </IconBtn>
      </div>
      {(m.procedural?.skills ?? []).map((s, si) => (
        <div key={si} className="mb-2">
          <div className="flex items-center gap-1">
            <Input value={s.name} mono className="w-40" onChange={(v) => update((d) => void (ensure(d).skills[si]!.name = v))} />
            <Input value={s.description} className="flex-1" placeholder="description" onChange={(v) => update((d) => void (ensure(d).skills[si]!.description = v))} />
            <IconBtn title="Remove" onClick={() => update((d) => ensure(d).skills.splice(si, 1))}>✕</IconBtn>
          </div>
          <Area value={s.code} rows={3} onChange={(v) => update((d) => void (ensure(d).skills[si]!.code = v))} />
        </div>
      ))}
    </div>
  );
}

function RubricEditor({ module: m, idx, update }: { module: MemoryModule; idx: number; update: Update }) {
  return (
    <div className="mt-3 rounded-lg bg-slate-900/50 p-2">
      <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
        <span>episode rubric</span>
        {m.rubric ? (
          <IconBtn title="Remove rubric" onClick={() => update((d) => void (d.memoryModules[idx]!.rubric = undefined))}>✕</IconBtn>
        ) : (
          <IconBtn title="Create rubric" onClick={() => update((d) => void (d.memoryModules[idx]!.rubric = newRubric()))}>
            + create rubric
          </IconBtn>
        )}
      </div>
      {m.rubric && (
        <>
          <div className="text-[11px] uppercase tracking-wide text-slate-500">scoring criteria</div>
          {m.rubric.criteria.map((c, ci) => (
            <div key={ci} className="mb-1 flex items-center gap-1">
              <Input value={c.name} className="w-44" onChange={(v) => update((d) => void (d.memoryModules[idx]!.rubric!.criteria[ci]!.name = v))} />
              <Input value={c.description} className="flex-1" placeholder="description" onChange={(v) => update((d) => void (d.memoryModules[idx]!.rubric!.criteria[ci]!.description = v))} />
              <IconBtn title="Remove" onClick={() => update((d) => d.memoryModules[idx]!.rubric!.criteria.splice(ci, 1))}>✕</IconBtn>
            </div>
          ))}
          <IconBtn title="Add criterion" onClick={() => update((d) => d.memoryModules[idx]!.rubric!.criteria.push({ name: "Criterion", description: "" }))}>
            + criterion
          </IconBtn>

          <div className="mt-2 text-[11px] uppercase tracking-wide text-slate-500">reflection prompts</div>
          {m.rubric.reflectionPrompts.map((rp, pi) => (
            <div key={pi} className="mb-1 flex items-center gap-1">
              <Input value={rp} className="flex-1" onChange={(v) => update((d) => void (d.memoryModules[idx]!.rubric!.reflectionPrompts[pi] = v))} />
              <IconBtn title="Remove" onClick={() => update((d) => d.memoryModules[idx]!.rubric!.reflectionPrompts.splice(pi, 1))}>✕</IconBtn>
            </div>
          ))}
          <IconBtn title="Add prompt" onClick={() => update((d) => d.memoryModules[idx]!.rubric!.reflectionPrompts.push("New reflection prompt"))}>
            + prompt
          </IconBtn>
        </>
      )}
    </div>
  );
}

/* ------------------------------- access ---------------------------------- */

function AccessSection({ agent, update }: { agent: Agent; update: Update }) {
  const ltm = agent.memoryModules.filter((m) => m.kind !== "working");

  const setGrant = (moduleId: string, mutate: (g: Agent["accessPolicy"][number]) => void) =>
    update((d) => {
      let g = d.accessPolicy.find((x) => x.memoryModuleId === moduleId);
      if (!g) {
        g = emptyGrant(moduleId);
        d.accessPolicy.push(g);
      }
      mutate(g);
      if (g.retrieval.enabled && !g.retrieval.method) g.retrieval.method = "relevance";
      const empty = !g.retrieval.enabled && !g.learning.add && !g.learning.modify && !g.learning.delete;
      if (empty) d.accessPolicy = d.accessPolicy.filter((x) => x.memoryModuleId !== moduleId);
    });

  return (
    <Section
      title="Access — internal action space"
      hint="Read = retrieval into working memory. Add/Modify/Delete = learning (writing to long-term memory)."
      whyId="access"
    >
      {ltm.length === 0 ? (
        <p className="text-sm text-slate-400">No long-term memory — nothing to access.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-slate-400">
              <th className="px-2 py-2 text-left">Memory</th>
              <th className="px-2 py-2"><span className="inline-flex items-center gap-1">Read <Why id="rule" /></span></th>
              <th className="px-2 py-2"><span className="inline-flex items-center gap-1">Add <Why id="learning-add" /></span></th>
              <th className="px-2 py-2"><span className="inline-flex items-center gap-1">Modify <Why id="learning-modify" /></span></th>
              <th className="px-2 py-2"><span className="inline-flex items-center gap-1">Delete <Why id="learning-delete" /></span></th>
            </tr>
          </thead>
          <tbody>
            {ltm.map((m) => {
              const g = agent.accessPolicy.find((x) => x.memoryModuleId === m.id);
              return (
                <tr key={m.id} className="border-t border-slate-800">
                  <td className="px-2 py-2">
                    <span className={MEMORY_KIND_META[m.kind].cls.split(" ")[0]}>●</span> {m.name}
                  </td>
                  <td className="px-2 py-2 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <input
                        type="checkbox"
                        checked={!!g?.retrieval.enabled}
                        onChange={(e) => setGrant(m.id, (gr) => void (gr.retrieval.enabled = e.target.checked))}
                        className="accent-emerald-500"
                      />
                      {g?.retrieval.enabled && (
                        <>
                          <Select
                            value={g.retrieval.method ?? "relevance"}
                            options={RetrievalMethod.options}
                            onChange={(v) => setGrant(m.id, (gr) => void (gr.retrieval.method = v))}
                          />
                          <Why id={g.retrieval.method ?? "relevance"} />
                        </>
                      )}
                    </div>
                  </td>
                  {(["add", "modify", "delete"] as const).map((op) => (
                    <td key={op} className="px-2 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={!!g?.learning[op]}
                        onChange={(e) => setGrant(m.id, (gr) => void (gr.learning[op] = e.target.checked))}
                        className="accent-emerald-500"
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Section>
  );
}

/* ------------------------------ grounding -------------------------------- */

export function GroundingSection({ agent, update }: { agent: Agent; update: Update }) {
  return (
    <Section
      title="Grounding — external action space"
      hint="How the agent affects the outside world."
      whyId="grounding"
      action={<IconBtn title="Add interface" onClick={() => update((d) => d.groundingInterfaces.push(newGrounding()))}>+ interface</IconBtn>}
    >
      <div className="space-y-3">
        {agent.groundingInterfaces.map((gi, gidx) => (
          <div key={gi.id} className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
            <div className="flex items-center gap-2">
              <Select
                value={gi.type}
                options={GroundingType.options}
                onChange={(v) => update((d) => void (d.groundingInterfaces[gidx]!.type = v))}
              />
              <Why id={gi.type} />
              <Input value={gi.name} onChange={(v) => update((d) => void (d.groundingInterfaces[gidx]!.name = v))} className="flex-1" />
              <IconBtn title="Delete interface" onClick={() => update((d) => d.groundingInterfaces.splice(gidx, 1))}>✕</IconBtn>
            </div>
            {gi.type === "digital" && (
              <div className="mt-2 pl-2">
                <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
                  <span>tools</span>
                  <IconBtn title="Add tool" onClick={() => update((d) => d.groundingInterfaces[gidx]!.digitalTools.push({ name: "tool", description: "" }))}>+ tool</IconBtn>
                </div>
                {gi.digitalTools.map((t, ti) => (
                  <div key={ti} className="mb-1 flex items-center gap-1">
                    <Input value={t.name} mono onChange={(v) => update((d) => void (d.groundingInterfaces[gidx]!.digitalTools[ti]!.name = v))} className="w-40" />
                    <Input value={t.description} onChange={(v) => update((d) => void (d.groundingInterfaces[gidx]!.digitalTools[ti]!.description = v))} className="flex-1" placeholder="description" />
                    <select
                      value={t.sideEffect ?? ""}
                      title="Side-effect class (drives the destructive-tool safety warning)"
                      onChange={(e) =>
                        update((d) => {
                          const v = e.target.value;
                          d.groundingInterfaces[gidx]!.digitalTools[ti]!.sideEffect =
                            v === "" ? undefined : (v as "read" | "write" | "destructive");
                        })
                      }
                      className="rounded border border-slate-700 bg-slate-950 px-1 py-1 text-xs outline-none focus:border-indigo-500"
                    >
                      <option value="">effect…</option>
                      <option value="read">read</option>
                      <option value="write">write</option>
                      <option value="destructive">destructive</option>
                    </select>
                    <IconBtn title="Remove tool" onClick={() => update((d) => d.groundingInterfaces[gidx]!.digitalTools.splice(ti, 1))}>✕</IconBtn>
                  </div>
                ))}

                {/* MCP backing — tools run for real against an MCP server (in-UI run + export). */}
                <div className="mt-2 rounded border border-slate-800 bg-slate-950/40 p-2">
                  <Check
                    checked={!!gi.mcp}
                    label="Backed by an MCP server"
                    onChange={(on) =>
                      update((d) => {
                        d.groundingInterfaces[gidx]!.mcp = on
                          ? { transport: "stdio", command: "", args: [] }
                          : undefined;
                      })
                    }
                  />
                  {gi.mcp && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      <Select
                        value={gi.mcp.transport}
                        options={["stdio", "http"] as const}
                        onChange={(v) => update((d) => void (d.groundingInterfaces[gidx]!.mcp!.transport = v))}
                      />
                      {gi.mcp.transport === "stdio" ? (
                        <>
                          <Input
                            value={gi.mcp.command ?? ""}
                            mono
                            placeholder="command (e.g. npx)"
                            onChange={(v) => update((d) => void (d.groundingInterfaces[gidx]!.mcp!.command = v))}
                            className="w-40"
                          />
                          <Input
                            value={(gi.mcp.args ?? []).join(" ")}
                            mono
                            placeholder="args (space-separated)"
                            onChange={(v) =>
                              update((d) => void (d.groundingInterfaces[gidx]!.mcp!.args = v.split(/\s+/).filter(Boolean)))
                            }
                            className="flex-1"
                          />
                        </>
                      ) : (
                        <Input
                          value={gi.mcp.url ?? ""}
                          mono
                          placeholder="https://your-mcp-server/mcp"
                          onChange={(v) => update((d) => void (d.groundingInterfaces[gidx]!.mcp!.url = v))}
                          className="flex-1"
                        />
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ------------------------------- decision -------------------------------- */

export function DecisionSection({ agent, update }: { agent: Agent; update: Update }) {
  const p = agent.decisionProcedure.planning;
  const stages = [
    { key: "Propose", field: "proposal" as const, stage: p.proposal, why: "proposal" },
    { key: "Evaluate", field: "evaluation" as const, stage: p.evaluation, why: "evaluation" },
    { key: "Select", field: "selection" as const, stage: p.selection, why: "selection" },
  ];
  return (
    <Section title="Decision procedure" hint="The planning loop run each decision cycle." whyId="decision">
      <div className="mb-3 flex items-center gap-2 text-sm">
        <span>Style</span>
        <Select
          value={agent.decisionProcedure.style}
          options={DecisionStyle.options}
          onChange={(v) => update((d) => void (d.decisionProcedure.style = v))}
        />
      </div>
      <div className="space-y-2">
        {stages.map(({ key, field, stage, why }) => (
          <div key={key} className="flex items-center gap-2">
            <Check
              checked={stage.enabled}
              onChange={(v) => update((d) => void (d.decisionProcedure.planning[field].enabled = v))}
              label={key}
            />
            <Why id={why} />
            {stage.enabled && (
              <Input
                value={stage.strategy ?? ""}
                onChange={(v) => update((d) => void (d.decisionProcedure.planning[field].strategy = v))}
                placeholder="strategy"
                className="flex-1"
              />
            )}
          </div>
        ))}
      </div>
      <div className="mt-3">
        <span className="text-xs text-slate-400">execution policy</span>
        <Area
          value={agent.decisionProcedure.executionPolicy ?? ""}
          onChange={(v) => update((d) => void (d.decisionProcedure.executionPolicy = v))}
        />
      </div>
    </Section>
  );
}

/* -------------------------------- export --------------------------------- */

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function zipFiles(files: { path: string; content: string }[], folderName: string, downloadName: string) {
  const zip = new JSZip();
  const folder = zip.folder(folderName)!;
  for (const f of files) folder.file(f.path, f.content);
  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = downloadName;
  a.click();
  URL.revokeObjectURL(url);
}

const downloadZip = (agent: Agent, lang: string, base: string) =>
  zipFiles(bundleAgent(agent, lang), `${base}-${lang}`, `${base}-${lang}.zip`);

const downloadScaffold = (agent: Agent, base: string) =>
  zipFiles(scaffoldMemory(agent), `${base}-memory`, `${base}-memory.zip`);

export function ExportBar({ agent }: { agent: Agent }) {
  const base = (agent.name || "agent").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const emitters = listEmitters();
  const [lang, setLang] = useState(emitters[0]?.id ?? "python");
  const [building, setBuilding] = useState(false);

  async function runnable() {
    setBuilding(true);
    try {
      await downloadZip(agent, lang, base);
    } finally {
      setBuilding(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Runnable agent — drop into your codebase
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value)}
            className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm outline-none focus:border-indigo-500"
          >
            {emitters.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
                {e.verified ? "" : " (preview)"}
              </option>
            ))}
          </select>
          <button
            onClick={runnable}
            disabled={building}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {building ? "Zipping…" : "Download project (.zip)"}
          </button>
          <span className="text-xs text-slate-500">
            self-contained runtime + your blueprint + tool stubs + framework glue + memory scaffold
          </span>
        </div>
      </div>

      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Memory scaffold
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => downloadScaffold(agent, base)}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:border-indigo-500"
          >
            Download memory/ (.zip)
          </button>
          <span className="text-xs text-slate-500">
            per-module docs · episode rubric templates · procedural prompt &amp; skill templates
          </span>
        </div>
      </div>

      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Blueprint &amp; codegen
        </div>
        <div className="flex flex-wrap gap-2">
          <IconBtn onClick={() => download(`${base}.blueprint.json`, toBlueprintJSON(agent), "application/json")}>JSON</IconBtn>
          <IconBtn onClick={() => download(`${base}.blueprint.yaml`, toBlueprintYAML(agent), "text/yaml")}>YAML</IconBtn>
          <IconBtn onClick={() => download("coala-blueprint.schema.json", JSON.stringify(blueprintJsonSchema(), null, 2), "application/json")}>JSON Schema</IconBtn>
          {listAdapters().map((a) => (
            <IconBtn
              key={a.id}
              onClick={() => {
                for (const f of generateCode(agent, a.id)) download(f.path, f.content, "text/plain");
              }}
            >
              {a.label}
            </IconBtn>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- blueprint board --------------------------- */

export function BlueprintBoard({
  result,
  onChange,
}: {
  result: BlueprintResult;
  onChange?: (agent: Agent) => void;
}) {
  const [agent, setAgent] = useState<Agent>(result.agent);
  const [advanced, setAdvanced] = useState(false);

  // Surface the live, edited agent to the parent (for Save/Share).
  useEffect(() => {
    onChange?.(agent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent]);

  const update: Update = (fn) =>
    setAgent((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex-1">
          <Input
            value={agent.name}
            onChange={(v) => update((d) => void (d.name = v))}
            className="w-full max-w-md text-xl font-bold"
          />
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {agent.goals.map((goal, i) => (
              <span key={i} className="flex items-center gap-1 rounded-full bg-slate-800 px-2.5 py-0.5 text-xs text-slate-300">
                <input
                  value={goal}
                  onChange={(e) => update((d) => void (d.goals[i] = e.target.value))}
                  className="w-40 bg-transparent outline-none"
                />
                <button onClick={() => update((d) => d.goals.splice(i, 1))} className="text-slate-500 hover:text-red-400">✕</button>
              </span>
            ))}
            <IconBtn title="Add goal" onClick={() => update((d) => d.goals.push("New goal"))}>+ goal</IconBtn>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-md border border-slate-700 px-2 py-1 font-mono text-xs text-slate-400">
            {agent.providerConfig.provider} · {agent.providerConfig.model}
          </span>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} className="accent-indigo-500" />
            Advanced
          </label>
        </div>
      </div>

      <Findings agent={agent} />

      <MemorySection agent={agent} update={update} advanced={advanced} />
      <AccessSection agent={agent} update={update} />

      <div className="grid gap-5 lg:grid-cols-2">
        <GroundingSection agent={agent} update={update} />
        <DecisionSection agent={agent} update={update} />
      </div>

      <Section
        title="Run · Phase 2"
        hint="Execute the decision cycle: retrieve → reason → act, with live memory writes."
      >
        <RunPanel agent={agent} />
      </Section>

      <Section title="Export" hint="Neutral CoALA Blueprint (source of truth) + codegen adapters.">
        <ExportBar agent={agent} />
      </Section>

      {advanced && (
        <Section title="Blueprint JSON" hint="Live view of the canonical document.">
          <pre className="max-h-96 overflow-auto rounded-lg bg-slate-950 p-4 text-xs text-slate-300">
            {JSON.stringify(agent, null, 2)}
          </pre>
        </Section>
      )}
    </div>
  );
}
