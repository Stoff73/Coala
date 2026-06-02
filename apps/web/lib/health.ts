import { lintAgent } from "@coala/core";
import type { Agent, Finding, Severity } from "@coala/core";

/** A board concern a finding can be attributed to (drives the map's status dots). */
export type Concern = "memory" | "perceive" | "act" | "decision";

export interface HealthItem {
  message: string;
  severity: Severity;
  concern: Concern | null;
}

export interface HealthSummary {
  status: "ok" | "attention"; // attention = has at least one error (blocks validity)
  headline: string;
  items: HealthItem[];
  byConcern: Record<Concern, boolean>; // true = some finding (error or warning) touches this concern
}

/** Map a finding's dotted `path` to the concern screen(s) it belongs to. */
function concernsForPath(path: string | undefined): Concern[] {
  if (!path) return [];
  if (path.startsWith("memoryModules") || path.startsWith("accessPolicy")) return ["memory"];
  if (path.startsWith("groundingInterfaces")) {
    // A whole-system "no grounding" finding (bare path) affects both input and output;
    // interface/tool-specific findings are about acting.
    return path === "groundingInterfaces" ? ["perceive", "act"] : ["act"];
  }
  if (path.startsWith("decisionProcedure")) return ["decision"];
  return [];
}

/** Translate lint findings into a plain-language health summary for the System Map. */
export function summarizeHealth(agent: Agent): HealthSummary {
  const raw = lintAgent(agent).findings.map((f: Finding) => ({
    message: f.message,
    severity: f.severity,
    concerns: concernsForPath(f.path),
  }));

  const items: HealthItem[] = raw.map((r) => ({
    message: r.message,
    severity: r.severity,
    concern: r.concerns[0] ?? null,
  }));

  const errors = items.filter((i) => i.severity === "error").length;
  const warnings = items.filter((i) => i.severity === "warning").length;

  const byConcern: Record<Concern, boolean> = { memory: false, perceive: false, act: false, decision: false };
  for (const r of raw) for (const c of r.concerns) byConcern[c] = true;

  const status: "ok" | "attention" = errors > 0 ? "attention" : "ok";
  const headline =
    errors > 0
      ? `${errors} thing${errors > 1 ? "s" : ""} to fix before this agent is valid`
      : warnings > 0
        ? `Ready to test · ${warnings} thing${warnings > 1 ? "s" : ""} to check`
        : "Ready to test";

  return { status, headline, items, byConcern };
}
