/**
 * @coala/export — the framework-neutral CoALA Blueprint serializers plus a
 * pluggable codegen registry (PLAN §6a). The neutral blueprint is the source of
 * truth; each framework (TypeScript, LangGraph, …) is just an adapter.
 */
export {
  toBlueprintJSON,
  toBlueprintYAML,
  blueprintJsonSchema,
  parseBlueprint,
} from "./blueprint.js";
export {
  ADAPTERS,
  listAdapters,
  generateCode,
} from "./codegen/registry.js";
export type { CodegenAdapter, GeneratedFile } from "./codegen/types.js";

// Runnable-agent bundles (self-contained projects per language).
export { EMITTERS, listEmitters, bundleAgent } from "./bundles/registry.js";
export type { LanguageEmitter } from "./bundles/types.js";

// Memory scaffolds — documented memory/ tree, episode rubrics, procedural templates.
export { scaffoldMemory } from "./scaffold/memory.js";
