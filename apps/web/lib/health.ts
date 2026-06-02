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

/** Map a finding's dotted `path` to the concern screen it belongs to. */
function concernForPath(path: string | undefined): Concern | null {
  if (!path) return null;
  if (path.startsWith("memoryModules") || path.startsWith("accessPolicy")) return "memory";
  if (path.startsWith("groundingInterfaces")) return "act";
  if (path.startsWith("decisionProcedure")) return "decision";
  return null;
}

/** Translate lint findings into a plain-language health summary for the System Map. */
export function summarizeHealth(agent: Agent): HealthSummary {
  const items: HealthItem[] = lintAgent(agent).findings.map((f: Finding) => ({
    message: f.message,
    severity: f.severity,
    concern: concernForPath(f.path),
  }));

  const errors = items.filter((i) => i.severity === "error").length;
  const warnings = items.filter((i) => i.severity === "warning").length;

  const byConcern: Record<Concern, boolean> = { memory: false, perceive: false, act: false, decision: false };
  for (const i of items) if (i.concern) byConcern[i.concern] = true;

  const status: "ok" | "attention" = errors > 0 ? "attention" : "ok";
  const headline =
    errors > 0
      ? `${errors} thing${errors > 1 ? "s" : ""} to fix before this agent is valid`
      : warnings > 0
        ? `Ready to test · ${warnings} thing${warnings > 1 ? "s" : ""} to check`
        : "Ready to test";

  return { status, headline, items, byConcern };
}
