import { z } from "zod";
import { DecisionStyle, Id } from "./common.js";

/** One sub-stage of the planning loop (paper §4.6: Propose → Evaluate → Select). */
export const PlanningSubStage = z.object({
  enabled: z.boolean().default(false),
  /** Free-text description of how this sub-stage is realised (e.g. "majority vote"). */
  strategy: z.string().optional(),
});
export type PlanningSubStage = z.infer<typeof PlanningSubStage>;

export const PlanningConfig = z.object({
  proposal: PlanningSubStage.default({ enabled: true }),
  evaluation: PlanningSubStage.default({ enabled: false }),
  selection: PlanningSubStage.default({ enabled: false }),
});
export type PlanningConfig = z.infer<typeof PlanningConfig>;

/** A reusable reasoning prompt template (procedural memory surfaced for decision-making). */
export const ReasoningTemplate = z.object({
  id: Id,
  name: z.string().min(1),
  template: z.string().default(""),
});
export type ReasoningTemplate = z.infer<typeof ReasoningTemplate>;

/**
 * The agent's top-level program: how reasoning/retrieval propose, evaluate and
 * select an external (grounding) or internal (learning) action each cycle.
 */
export const DecisionProcedure = z.object({
  style: DecisionStyle,
  planning: PlanningConfig.default({}),
  reasoningTemplates: z.array(ReasoningTemplate).default([]),
  /** How the selected action is executed and the cycle loops (free-text for v1). */
  executionPolicy: z.string().optional(),
});
export type DecisionProcedure = z.infer<typeof DecisionProcedure>;
