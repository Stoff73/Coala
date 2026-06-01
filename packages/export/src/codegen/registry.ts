import type { Agent } from "@coala/core";
import type { CodegenAdapter, GeneratedFile } from "./types.js";
import { typescriptAdapter } from "./typescript.js";
import { langgraphAdapter } from "./langgraph.js";

/** Registered codegen targets. Add a framework here; nothing else changes. */
export const ADAPTERS: Record<string, CodegenAdapter> = {
  [typescriptAdapter.id]: typescriptAdapter,
  [langgraphAdapter.id]: langgraphAdapter,
};

export function listAdapters(): Array<{ id: string; label: string }> {
  return Object.values(ADAPTERS).map((a) => ({ id: a.id, label: a.label }));
}

export function generateCode(agent: Agent, adapterId: string): GeneratedFile[] {
  const adapter = ADAPTERS[adapterId];
  if (!adapter) throw new Error(`Unknown codegen adapter: ${adapterId}`);
  return adapter.generate(agent);
}
