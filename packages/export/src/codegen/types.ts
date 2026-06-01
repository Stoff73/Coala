import type { Agent } from "@coala/core";

export interface GeneratedFile {
  path: string;
  content: string;
  language: string;
}

/** A pluggable codegen target. Adding a framework never touches the core (PLAN §6a). */
export interface CodegenAdapter {
  id: string;
  label: string;
  generate(agent: Agent): GeneratedFile[];
}

export function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "agent"
  );
}

export function pascal(s: string): string {
  return s
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}
