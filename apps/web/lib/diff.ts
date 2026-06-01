import type { Agent, MemoryModule } from "@coala/core";

const norm = (s: string) => s.trim().toLowerCase();
/** Match modules across re-inferences by kind+name (ids are regenerated each run). */
const memKey = (m: MemoryModule) => `${m.kind}:${norm(m.name)}`;

export interface AgentDiff {
  hasChanges: boolean;
  memory: { added: string[]; removed: string[]; changed: string[] };
  access: string[];
  grounding: { added: string[]; removed: string[] };
  decision: string[];
  goals: { added: string[]; removed: string[] };
}

function accessByKey(a: Agent): Map<string, string> {
  const byId = new Map(a.memoryModules.map((m) => [m.id, m]));
  const map = new Map<string, string>();
  for (const g of a.accessPolicy) {
    const m = byId.get(g.memoryModuleId);
    if (!m) continue;
    map.set(
      memKey(m),
      `R${g.retrieval.enabled ? 1 : 0} A${g.learning.add ? 1 : 0} M${g.learning.modify ? 1 : 0} D${g.learning.delete ? 1 : 0}`,
    );
  }
  return map;
}

/** A human-readable diff of what `next` would change relative to `current`. */
export function diffAgents(current: Agent, next: Agent): AgentDiff {
  const curMem = new Map(current.memoryModules.map((m) => [memKey(m), m]));
  const nextMem = new Map(next.memoryModules.map((m) => [memKey(m), m]));

  const added = [...nextMem].filter(([k]) => !curMem.has(k)).map(([, m]) => m.name);
  const removed = [...curMem].filter(([k]) => !nextMem.has(k)).map(([, m]) => m.name);
  const changed: string[] = [];
  for (const [k, m] of curMem) {
    const n = nextMem.get(k);
    if (!n) continue;
    const d: string[] = [];
    if ((m.description || "") !== (n.description || "")) d.push("description");
    if (JSON.stringify(m.schema?.fields ?? []) !== JSON.stringify(n.schema?.fields ?? [])) d.push("schema");
    if (m.retrievalConfig?.method !== n.retrievalConfig?.method) d.push("retrieval");
    if (d.length) changed.push(`${m.name} (${d.join(", ")})`);
  }

  const ca = accessByKey(current);
  const na = accessByKey(next);
  const access: string[] = [];
  for (const k of new Set([...ca.keys(), ...na.keys()])) {
    if (ca.get(k) !== na.get(k)) {
      const name = (nextMem.get(k) ?? curMem.get(k))?.name ?? k;
      access.push(`${name}: ${ca.get(k) ?? "none"} → ${na.get(k) ?? "none"}`);
    }
  }

  const cg = new Set(current.groundingInterfaces.map((g) => norm(g.name)));
  const ng = new Set(next.groundingInterfaces.map((g) => norm(g.name)));
  const gAdded = next.groundingInterfaces.filter((g) => !cg.has(norm(g.name))).map((g) => g.name);
  const gRemoved = current.groundingInterfaces.filter((g) => !ng.has(norm(g.name))).map((g) => g.name);

  const planStr = (a: Agent) => {
    const p = a.decisionProcedure.planning;
    return `${p.proposal.enabled ? "P" : ""}${p.evaluation.enabled ? "E" : ""}${p.selection.enabled ? "S" : ""}`;
  };
  const decision: string[] = [];
  if (current.decisionProcedure.style !== next.decisionProcedure.style)
    decision.push(`style ${current.decisionProcedure.style} → ${next.decisionProcedure.style}`);
  if (planStr(current) !== planStr(next))
    decision.push(`planning ${planStr(current) || "—"} → ${planStr(next) || "—"}`);

  const cgo = new Set(current.goals.map(norm));
  const ngo = new Set(next.goals.map(norm));
  const goalAdded = next.goals.filter((g) => !cgo.has(norm(g)));
  const goalRemoved = current.goals.filter((g) => !ngo.has(norm(g)));

  const hasChanges =
    added.length + removed.length + changed.length + access.length + gAdded.length + gRemoved.length + decision.length + goalAdded.length + goalRemoved.length >
    0;

  return {
    hasChanges,
    memory: { added, removed, changed },
    access,
    grounding: { added: gAdded, removed: gRemoved },
    decision,
    goals: { added: goalAdded, removed: goalRemoved },
  };
}

/**
 * Merge: take `next` as the new structure but carry over the user's data and additions —
 * seed records on matched modules, user-added modules/tools/goals not in `next`, and the
 * user's title. Edits aren't lost; the fresh structure is adopted.
 */
export function mergeAgents(current: Agent, next: Agent): Agent {
  const merged: Agent = structuredClone(next);
  merged.name = current.name;

  const curByKey = new Map(current.memoryModules.map((m) => [memKey(m), m]));
  for (const m of merged.memoryModules) {
    const cur = curByKey.get(memKey(m));
    if (!cur?.records.length) continue;
    const seen = new Set(m.records.map((r) => JSON.stringify(r.data)));
    for (const r of cur.records) if (!seen.has(JSON.stringify(r.data))) m.records.push(r);
  }

  const nextKeys = new Set(merged.memoryModules.map(memKey));
  for (const m of current.memoryModules) {
    if (nextKeys.has(memKey(m))) continue;
    merged.memoryModules.push(m);
    const g = current.accessPolicy.find((a) => a.memoryModuleId === m.id);
    if (g) merged.accessPolicy.push(g);
  }

  const nextGByName = new Map(merged.groundingInterfaces.map((g) => [norm(g.name), g]));
  for (const g of current.groundingInterfaces) {
    const match = nextGByName.get(norm(g.name));
    if (!match) {
      merged.groundingInterfaces.push(g); // whole interface the user added
      continue;
    }
    // union the user's tools into the matched interface; keep the user's MCP backing if any
    const have = new Set(match.digitalTools.map((t) => norm(t.name)));
    for (const t of g.digitalTools) if (!have.has(norm(t.name))) match.digitalTools.push(t);
    if (g.mcp && !match.mcp) match.mcp = g.mcp;
  }

  const haveGoals = new Set(merged.goals.map(norm));
  for (const go of current.goals) if (!haveGoals.has(norm(go))) merged.goals.push(go);

  return merged;
}
