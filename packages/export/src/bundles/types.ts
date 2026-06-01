import type { Agent } from "@coala/core";
import type { GeneratedFile } from "../codegen/types.js";

/** A target language/runtime that produces a complete, runnable agent project. */
export interface LanguageEmitter {
  id: string;
  label: string;
  /** Whether this emitter's runtime was execution-verified in CI. */
  verified: boolean;
  files(agent: Agent): GeneratedFile[];
}

export type { GeneratedFile };

/** Digital grounding tools the agent can call (its external action space). */
export function digitalTools(agent: Agent): { name: string; description: string }[] {
  return agent.groundingInterfaces
    .filter((g) => g.type === "digital")
    .flatMap((g) => g.digitalTools.map((t) => ({ name: t.name, description: t.description })));
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "agent";
}

/** snake_case identifier from an arbitrary tool name. */
export function snake(s: string): string {
  return (
    s
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .toLowerCase()
      .replace(/^_+|_+$/g, "") || "tool"
  );
}

/** PascalCase identifier. */
export function pascal(s: string): string {
  return s
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("") || "Agent";
}

/** The canonical blueprint, pretty-printed — shared by every bundle as data. */
export function blueprintJson(agent: Agent): string {
  return JSON.stringify(agent, null, 2);
}
