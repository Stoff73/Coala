/**
 * @coala/core — the CoALA domain model, invariant linter, and preset archetypes.
 * Every other package (inference, export, runtime, web) depends on these types.
 */

// Domain model (schemas + inferred types)
export * from "./schema/common.js";
export * from "./schema/memory.js";
export * from "./schema/action.js";
export * from "./schema/decision.js";
export * from "./schema/agent.js";

// Invariant linter (PLAN §7)
export * from "./invariants/lint.js";

// Table 2 / §6 preset archetypes (PLAN §3)
export * from "./presets/index.js";
