"use client";

import { useEffect, useState } from "react";
import { lintAgent } from "@coala/core";
import type { Agent, ProviderName } from "@coala/core";
import { AgentWorkspace } from "../components/workspace/agent-workspace";
import type { BlueprintResult } from "../lib/types";
import { useMe } from "../lib/useMe";
import { diffAgents, mergeAgents, type AgentDiff } from "../lib/diff";

const PROVIDER_DEFAULT_MODEL: Record<ProviderName, string> = {
  anthropic: "claude-opus-4-8",
  openai: "gpt-4o",
  xai: "grok-2-latest",
  google: "gemini-1.5-pro",
  ollama: "llama3.1",
  local: "local-model",
};

const PROVIDERS: ProviderName[] = ["anthropic", "openai", "xai", "google", "ollama", "local"];

const EXAMPLE =
  "A personalized shopping assistant that helps users find relevant items from our catalog based on their query and past purchases, returning results through a chat conversation.";

const JSON_HEADERS = { "content-type": "application/json" };

export default function Page() {
  const me = useMe();

  const [name, setName] = useState("Retail Assistant");
  const [spec, setSpec] = useState(EXAMPLE);
  const [provider, setProvider] = useState<ProviderName>("anthropic");
  const [model, setModel] = useState(PROVIDER_DEFAULT_MODEL.anthropic);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BlueprintResult | null>(null);
  const [version, setVersion] = useState(0);
  const [presets, setPresets] = useState<BlueprintResult[]>([]);

  // Persistence state.
  const [currentAgent, setCurrentAgent] = useState<Agent | null>(null);
  const [baseline, setBaseline] = useState<Agent | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [savedVersion, setSavedVersion] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [teamWorkspaces, setTeamWorkspaces] = useState<{ id: string; name: string }[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);

  // Diff-on-reinfer: a freshly inferred blueprint waiting on the user when they have unsaved edits.
  const [pending, setPending] = useState<{ next: Agent; diff: AgentDiff } | null>(null);

  function applyAgent(agent: Agent, opts?: { id?: string; version?: number; workspaceId?: string | null }) {
    const lint = lintAgent(agent);
    setResult({ agent, findings: lint.findings, ok: lint.ok });
    setCurrentAgent(agent);
    setBaseline(structuredClone(agent));
    setPending(null);
    setSavedId(opts?.id ?? null);
    setSavedVersion(opts?.version ?? null);
    setWorkspaceId(opts?.workspaceId ?? null);
    setSaveMsg(null);
    setShareUrl(null);
    setError(null);
    setVersion((v) => v + 1);
  }

  /** True if the user has edited the board since the last apply. */
  function hasUnsavedEdits(): boolean {
    return !!(baseline && currentAgent && diffAgents(baseline, currentAgent).hasChanges);
  }

  // Load presets, and any ?id= / ?share= blueprint from the URL.
  useEffect(() => {
    fetch("/api/presets")
      .then((r) => r.json())
      .then((d: { presets: BlueprintResult[] }) => setPresets(d.presets ?? []))
      .catch(() => setPresets([]));

    // Team workspaces the user can save into (excludes their personal workspace).
    fetch("/api/workspaces")
      .then((r) => (r.ok ? r.json() : { workspaces: [] }))
      .then((d: { workspaces?: { id: string; name: string; personal: boolean }[] }) =>
        setTeamWorkspaces((d.workspaces ?? []).filter((w) => !w.personal)),
      )
      .catch(() => setTeamWorkspaces([]));

    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    const share = params.get("share");
    if (id) {
      fetch(`/api/blueprints/${id}`)
        .then((r) => r.json())
        .then((d) => {
          if (d.blueprint)
            applyAgent(d.blueprint.agent, {
              id: d.blueprint.id,
              version: d.blueprint.version,
              workspaceId: d.blueprint.workspaceId ?? null,
            });
          else setError(d.error ?? "Could not load blueprint.");
        });
    } else if (share) {
      fetch(`/api/shared/${share}`)
        .then((r) => r.json())
        .then((d) => {
          if (d.blueprint) applyAgent(d.blueprint.agent); // a shared copy; Save creates your own
          else setError(d.error ?? "Could not open shared blueprint.");
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pickProvider(p: ProviderName) {
    setProvider(p);
    setModel(PROVIDER_DEFAULT_MODEL[p]);
  }

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/infer", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ name, naturalLanguageSpec: spec, provider, model }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Inference failed.");
        return;
      }
      const next = data.agent as Agent;
      // Don't silently overwrite the user's edits — show a diff to resolve.
      if (currentAgent && hasUnsavedEdits()) {
        setPending({ next, diff: diffAgents(currentAgent, next) });
      } else {
        applyAgent(next);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
    } finally {
      setLoading(false);
    }
  }

  function loadPreset(key: string) {
    const found = presets.find((p) => p.agent.metadata.preset === key);
    if (!found) return;
    if (hasUnsavedEdits() && !window.confirm("Discard your unsaved edits and load this preset?")) return;
    applyAgent(found.agent);
  }

  // Diff-on-reinfer resolutions.
  function resolveReplace() {
    if (pending) applyAgent(pending.next);
  }
  function resolveKeepMine() {
    setPending(null);
  }
  function resolveMerge() {
    if (pending && currentAgent) applyAgent(mergeAgents(currentAgent, pending.next));
  }

  async function save(): Promise<string | null> {
    if (!currentAgent) return null;
    if (me === null) {
      window.location.assign("/login");
      return null;
    }
    setSaving(true);
    setSaveMsg(null);
    try {
      const payload = { name: currentAgent.name, agent: currentAgent, workspaceId };
      const res = savedId
        ? await fetch(`/api/blueprints/${savedId}`, { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify(payload) })
        : await fetch("/api/blueprints", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) {
        setSaveMsg(data.error ?? "Save failed.");
        return null;
      }
      setSavedId(data.blueprint.id);
      setSavedVersion(data.blueprint.version);
      setSaveMsg(`Saved · v${data.blueprint.version}`);
      window.history.replaceState(null, "", `/?id=${data.blueprint.id}`);
      return data.blueprint.id as string;
    } finally {
      setSaving(false);
    }
  }

  async function share() {
    const id = savedId ?? (await save());
    if (!id) return;
    const res = await fetch(`/api/blueprints/${id}/share`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ role: "view" }),
    });
    const data = await res.json();
    if (res.ok) setShareUrl(`${window.location.origin}/?share=${data.share.token}`);
    else setSaveMsg(data.error ?? "Could not create share link.");
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">CoALA Agent Builder</h1>
        <p className="mt-1 text-slate-400">
          Describe an agent in plain English — we work out its CoALA memory modules, action space,
          and decision procedure.
        </p>
      </header>

      <section className="mb-6 rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
        <div className="grid gap-4 md:grid-cols-3">
          <label className="md:col-span-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Agent name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
          </label>

          <label className="md:col-span-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Provider &amp; model</span>
            <div className="mt-1 flex gap-2">
              <select
                value={provider}
                onChange={(e) => pickProvider(e.target.value as ProviderName)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-indigo-500"
              >
                {PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm outline-none focus:border-indigo-500"
              />
            </div>
          </label>

          <label className="md:col-span-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Describe the agent</span>
            <textarea
              value={spec}
              onChange={(e) => setSpec(e.target.value)}
              rows={3}
              className="mt-1 w-full resize-y rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={generate}
            disabled={loading || !name.trim() || !spec.trim()}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Inferring…" : "Generate blueprint"}
          </button>

          {presets.length > 0 && (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <span>or load a preset:</span>
              <select
                defaultValue=""
                onChange={(e) => e.target.value && loadPreset(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm outline-none focus:border-indigo-500"
              >
                <option value="" disabled>
                  Table 2 archetypes…
                </option>
                {presets.map((p) => (
                  <option key={p.agent.id} value={p.agent.metadata.preset}>
                    {p.agent.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">
            {error}
          </div>
        )}
      </section>

      {pending && (
        <div className="mb-5 rounded-2xl border border-amber-500/50 bg-amber-500/10 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-amber-200">New inference ready — you have unsaved edits</h3>
              <p className="text-xs text-amber-200/80">
                Choose how to apply it. <strong>Merge</strong> adopts the new structure but keeps your records,
                added modules/tools, and title.
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={resolveMerge} className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-slate-900 hover:bg-amber-400">
                Merge
              </button>
              <button onClick={resolveReplace} className="rounded-lg border border-amber-500/60 px-3 py-1.5 text-sm text-amber-100 hover:bg-amber-500/20">
                Replace
              </button>
              <button onClick={resolveKeepMine} className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800">
                Keep mine
              </button>
            </div>
          </div>
          <DiffView diff={pending.diff} />
        </div>
      )}

      {result && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/40 px-5 py-3">
          <button
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {saving ? "Saving…" : savedId ? "Save changes" : "Save"}
          </button>
          <button
            onClick={share}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:border-indigo-500"
          >
            Share link
          </button>
          {me && (
            <label className="flex items-center gap-1.5 text-xs text-slate-400">
              save to
              <select
                value={workspaceId ?? ""}
                onChange={(e) => setWorkspaceId(e.target.value || null)}
                className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs outline-none focus:border-indigo-500"
              >
                <option value="">Private (only me)</option>
                {teamWorkspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {savedVersion && <span className="text-xs text-slate-500">version {savedVersion}</span>}
          {saveMsg && <span className="text-xs text-emerald-400">{saveMsg}</span>}
          {me === null && <span className="text-xs text-slate-500">— sign in to save</span>}
          {shareUrl && (
            <input
              readOnly
              value={shareUrl}
              onFocus={(e) => e.target.select()}
              className="ml-auto w-72 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-300"
            />
          )}
        </div>
      )}

      {result ? (
        <AgentWorkspace key={version} result={result} onChange={setCurrentAgent} />
      ) : (
        <p className="text-center text-sm text-slate-500">
          Generate a blueprint or load a preset to see the CoALA board.
        </p>
      )}
    </main>
  );
}

function DiffRow({ label, items, tone }: { label: string; items: string[]; tone: string }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-2 text-xs">
      <span className={`font-semibold ${tone}`}>{label}</span>
      <ul className="ml-4 list-disc text-slate-300">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}

function DiffView({ diff }: { diff: AgentDiff }) {
  if (!diff.hasChanges) {
    return <p className="mt-3 text-xs text-slate-400">The new inference is identical to your current blueprint.</p>;
  }
  return (
    <div className="mt-3 grid gap-x-8 gap-y-1 sm:grid-cols-2">
      <DiffRow label="Memory added" items={diff.memory.added} tone="text-emerald-400" />
      <DiffRow label="Memory removed" items={diff.memory.removed} tone="text-red-400" />
      <DiffRow label="Memory changed" items={diff.memory.changed} tone="text-sky-400" />
      <DiffRow label="Access changes" items={diff.access} tone="text-sky-400" />
      <DiffRow label="Grounding added" items={diff.grounding.added} tone="text-emerald-400" />
      <DiffRow label="Grounding removed" items={diff.grounding.removed} tone="text-red-400" />
      <DiffRow label="Decision" items={diff.decision} tone="text-sky-400" />
      <DiffRow label="Goals added" items={diff.goals.added} tone="text-emerald-400" />
      <DiffRow label="Goals removed" items={diff.goals.removed} tone="text-red-400" />
    </div>
  );
}
