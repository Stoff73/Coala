import { z } from "zod";
import {
  DecisionStyle,
  FieldType,
  GroundingType,
  MemoryKind,
  RetrievalMethod,
} from "@coala/core";

/**
 * Narrow, LLM-friendly output schemas for each inference pass. They are deliberately
 * simpler than the full Agent model — the assembler (assemble.ts) maps them up into
 * the canonical CoALA blueprint, assigning ids, backing stores, and defaults.
 */

const DraftField = z.object({
  name: z.string(),
  type: FieldType,
  description: z.string().optional(),
  required: z.boolean().optional(),
});

const DraftRecordSchema = z.object({
  title: z.string(),
  fields: z.array(DraftField).default([]),
});

/** Pass A — which memory modules the agent needs (paper §6 step a). */
export const MemoryPassOutput = z.object({
  goals: z.array(z.string()).default([]),
  modules: z
    .array(
      z.object({
        kind: MemoryKind,
        name: z.string(),
        description: z.string().default(""),
        rationale: z.string().default(""),
        recordSchema: DraftRecordSchema.optional(),
      }),
    )
    .default([]),
});
export type MemoryPassOutput = z.infer<typeof MemoryPassOutput>;

/** Pass B — read/write access per module (the internal action space; §6 step b). */
export const AccessPassOutput = z.object({
  grants: z
    .array(
      z.object({
        moduleName: z.string(),
        read: z.boolean().default(false),
        retrievalMethod: RetrievalMethod.optional(),
        add: z.boolean().default(false),
        modify: z.boolean().default(false),
        delete: z.boolean().default(false),
        rationale: z.string().optional(),
      }),
    )
    .default([]),
});
export type AccessPassOutput = z.infer<typeof AccessPassOutput>;

const DraftSubStage = z.object({
  enabled: z.boolean().default(false),
  strategy: z.string().optional(),
});

/** Pass C — decision procedure + external action space (§6 step c). */
export const DecisionPassOutput = z.object({
  style: DecisionStyle,
  proposal: DraftSubStage.default({ enabled: true }),
  evaluation: DraftSubStage.default({ enabled: false }),
  selection: DraftSubStage.default({ enabled: false }),
  executionPolicy: z.string().optional(),
  grounding: z
    .array(
      z.object({
        type: GroundingType,
        name: z.string(),
        description: z.string().default(""),
        tools: z
          .array(z.object({ name: z.string(), description: z.string().default("") }))
          .optional(),
      }),
    )
    .default([]),
});
export type DecisionPassOutput = z.infer<typeof DecisionPassOutput>;
