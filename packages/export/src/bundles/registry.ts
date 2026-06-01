import type { Agent } from "@coala/core";
import type { GeneratedFile, LanguageEmitter } from "./types.js";
import { scaffoldMemory } from "../scaffold/memory.js";
import { pythonEmitter } from "./python.js";
import { typescriptEmitter } from "./typescript.js";
import { phpEmitter } from "./php.js";
import { goEmitter } from "./go.js";
import { rubyEmitter } from "./ruby.js";
import { javaEmitter } from "./java.js";
import { csharpEmitter } from "./csharp.js";

/** Registered runnable-agent emitters. Each produces a complete drop-in project. */
export const EMITTERS: Record<string, LanguageEmitter> = {
  [pythonEmitter.id]: pythonEmitter,
  [typescriptEmitter.id]: typescriptEmitter,
  [phpEmitter.id]: phpEmitter,
  [goEmitter.id]: goEmitter,
  [rubyEmitter.id]: rubyEmitter,
  [javaEmitter.id]: javaEmitter,
  [csharpEmitter.id]: csharpEmitter,
};

export function listEmitters(): Array<{ id: string; label: string; verified: boolean }> {
  return Object.values(EMITTERS).map((e) => ({ id: e.id, label: e.label, verified: e.verified }));
}

/** Produce a complete runnable agent project (incl. the documented memory/ scaffold). */
export function bundleAgent(agent: Agent, langId: string): GeneratedFile[] {
  const emitter = EMITTERS[langId];
  if (!emitter) throw new Error(`Unknown language: ${langId}`);
  return [...emitter.files(agent), ...scaffoldMemory(agent)];
}
