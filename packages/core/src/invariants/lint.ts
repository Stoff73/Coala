import type { Agent } from "../schema/agent.js";
import type { MemoryModule } from "../schema/memory.js";

export type Severity = "error" | "warning" | "info";

export interface Finding {
  rule: string;
  severity: Severity;
  message: string;
  /** Dotted path into the Agent document, when a specific node is implicated. */
  path?: string;
}

export interface LintResult {
  findings: Finding[];
  ok: boolean; // true when there are zero errors (warnings/info allowed)
}

/**
 * Each rule inspects an Agent and emits zero or more findings.
 * Rules encode CoALA's design guidance (paper §4, §6 / PLAN §7) so blueprints
 * stay sound and the UI can teach the framework inline.
 */
type Rule = (agent: Agent) => Finding[];

const byId = (agent: Agent): Map<string, MemoryModule> =>
  new Map(agent.memoryModules.map((m) => [m.id, m]));

/** A module must exist for each required kind. */
const proceduralRequired: Rule = (agent) =>
  agent.memoryModules.some((m) => m.kind === "procedural")
    ? []
    : [
        {
          rule: "procedural-memory-required",
          severity: "error",
          message:
            "Every agent needs procedural memory (the LLM + agent code); it must be initialized by the designer (§4.1).",
          path: "memoryModules",
        },
      ];

const workingRequired: Rule = (agent) =>
  agent.memoryModules.some((m) => m.kind === "working")
    ? []
    : [
        {
          rule: "working-memory-required",
          severity: "error",
          message:
            "Working memory is mandatory — it is the central hub connecting the LLM, long-term memory, and grounding (§4.1).",
          path: "memoryModules",
        },
      ];

const groundingRequired: Rule = (agent) =>
  agent.groundingInterfaces.length > 0
    ? []
    : [
        {
          rule: "grounding-required",
          severity: "error",
          message:
            "An agent with no external action space cannot affect anything — add at least one grounding interface (§4.2).",
          path: "groundingInterfaces",
        },
      ];

/** Access grants must reference real modules, and obey read/write semantics. */
const accessIntegrity: Rule = (agent) => {
  const findings: Finding[] = [];
  const modules = byId(agent);

  agent.accessPolicy.forEach((grant, i) => {
    const path = `accessPolicy[${i}]`;
    const mod = modules.get(grant.memoryModuleId);

    if (!mod) {
      findings.push({
        rule: "access-references-existing-module",
        severity: "error",
        message: `Access grant references unknown memory module "${grant.memoryModuleId}".`,
        path,
      });
      return;
    }

    const learns =
      grant.learning.add || grant.learning.modify || grant.learning.delete;

    // Learning writes to long-term memory; working memory is updated by reasoning, not learning.
    if (learns && mod.kind === "working") {
      findings.push({
        rule: "learning-targets-long-term-memory",
        severity: "error",
        message:
          "Learning actions write to long-term memory. Working memory is updated by reasoning, not learning (§4.4–4.5).",
        path,
      });
    }

    // Read access requires a concrete retrieval method (§4.3).
    if (grant.retrieval.enabled && !grant.retrieval.method) {
      findings.push({
        rule: "retrieval-requires-method",
        severity: "error",
        message:
          "Read access requires a retrieval method (recency / importance / relevance / embedding / rule) (§4.3).",
        path,
      });
    }

    // Retrieving from working memory is a category error — it is not a long-term store.
    if (grant.retrieval.enabled && mod.kind === "working") {
      findings.push({
        rule: "retrieval-targets-long-term-memory",
        severity: "warning",
        message:
          "Working memory is the hub, not a retrieval source. Retrieval reads from long-term memory into working memory.",
        path,
      });
    }
  });

  return findings;
};

/** Safety flags (§6 "safety of the action space"). These default OFF and warn loudly. */
const safetyFlags: Rule = (agent) => {
  const findings: Finding[] = [];
  const modules = byId(agent);

  agent.accessPolicy.forEach((grant, i) => {
    const mod = modules.get(grant.memoryModuleId);
    if (!mod) return;
    const path = `accessPolicy[${i}]`;

    const writesProcedural =
      mod.kind === "procedural" &&
      (grant.learning.add || grant.learning.modify || grant.learning.delete);
    if (writesProcedural) {
      findings.push({
        rule: "procedural-write-safety",
        severity: "warning",
        message:
          "Writing to procedural memory lets the agent modify its own code — powerful but risky; it can introduce bugs or subvert designer intent (§4.1, §6).",
        path,
      });
    }

    if (grant.learning.delete) {
      findings.push({
        rule: "unlearning-safety",
        severity: "warning",
        message:
          'Delete access enables "unlearning" of memory items — understudied and risky; confirm this is intended (§4.5, §6).',
        path,
      });
    }
  });

  return findings;
};

/**
 * External-action-space safety (§6). A "destructive" digital tool may have irreversible
 * effects on the world (the paper names "rm" in a bash terminal as an example). Warn when a
 * tool is declared destructive, or — when untagged — when its name/description matches a
 * destructive verb. An explicit read/write tag suppresses the heuristic.
 */
const DESTRUCTIVE_VERBS = [
  "delete", "remove", "drop", "purge", "destroy", "wipe", "erase", "truncate",
  "overwrite", "terminate", "uninstall", "revoke", "transfer", "pay", "charge",
  "refund", "deploy",
] as const;

// Letter-only lookarounds match whole verbs (delete_record / "delete record") but not substrings (undeleted).
const DESTRUCTIVE_RE = new RegExp(`(?<![a-z])(${DESTRUCTIVE_VERBS.join("|")})(?![a-z])`);

const destructiveToolSafety: Rule = (agent) => {
  const findings: Finding[] = [];
  agent.groundingInterfaces.forEach((gi, gidx) => {
    if (gi.type !== "digital") return;
    gi.digitalTools.forEach((tool, tidx) => {
      const path = `groundingInterfaces[${gidx}].digitalTools[${tidx}]`;
      if (tool.sideEffect === "destructive") {
        findings.push({
          rule: "destructive-tool-safety",
          severity: "warning",
          message: `Tool "${tool.name}" is declared destructive — its effects on the world may be irreversible (the paper names "rm" in a bash terminal as an example). Confirm the decision procedure gates it (§6).`,
          path,
        });
        return;
      }
      // Explicit read/write tag means the designer has classified it — trust them.
      if (tool.sideEffect) return;
      // Split camelCase (deleteRecord → "delete Record") so camelCase tool names match too.
      const haystack = `${tool.name} ${tool.description}`.replace(/([A-Z])/g, " $1").toLowerCase();
      const match = DESTRUCTIVE_RE.exec(haystack);
      if (match) {
        findings.push({
          rule: "destructive-tool-safety",
          severity: "warning",
          message: `Tool "${tool.name}" looks destructive (matched "${match[1]}"). Tag its side-effect (read / write / destructive) to confirm or silence this (§4.2, §6).`,
          path,
        });
      }
    });
  });
  return findings;
};

/** Long-term stores benefit from a defined record schema (the "memory model"). */
const ltmShouldHaveSchema: Rule = (agent) =>
  agent.memoryModules
    .filter((m) => (m.kind === "semantic" || m.kind === "episodic") && !m.schema)
    .map((m) => ({
      rule: "ltm-store-needs-schema",
      severity: "warning" as const,
      message: `${m.kind} module "${m.name}" has no record schema; define one so records can be validated and retrieved consistently.`,
      path: `memoryModules#${m.id}`,
    }));

/** Large action space → nudge toward a structured decision procedure (§6 tradeoff). */
const actionSpaceVsDecision: Rule = (agent) => {
  const tools = agent.groundingInterfaces.reduce(
    (n, g) => n + g.digitalTools.length,
    0,
  );
  const writableModules = agent.accessPolicy.filter(
    (g) => g.learning.add || g.learning.modify || g.learning.delete,
  ).length;
  const actionSpaceSize = tools + writableModules;

  const onlyProposes =
    agent.decisionProcedure.planning.proposal.enabled &&
    !agent.decisionProcedure.planning.evaluation.enabled &&
    !agent.decisionProcedure.planning.selection.enabled;

  if (actionSpaceSize > 4 && onlyProposes) {
    return [
      {
        rule: "structured-decision-for-large-action-space",
        severity: "info",
        message:
          "This agent has a large action space but only proposes actions. Consider adding evaluation/selection sub-stages to manage decision complexity (§6).",
        path: "decisionProcedure.planning",
      },
    ];
  }
  return [];
};

const RULES: Rule[] = [
  proceduralRequired,
  workingRequired,
  groundingRequired,
  accessIntegrity,
  safetyFlags,
  destructiveToolSafety,
  ltmShouldHaveSchema,
  actionSpaceVsDecision,
];

/** Run every CoALA invariant against an agent blueprint. */
export function lintAgent(agent: Agent): LintResult {
  const findings = RULES.flatMap((rule) => rule(agent));
  return {
    findings,
    ok: !findings.some((f) => f.severity === "error"),
  };
}
