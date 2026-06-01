import { z } from "zod";

/**
 * The structured action the LLM proposes each cycle. Covers CoALA's action space:
 * grounding (external tool), learning (write to long-term memory), respond
 * (dialogue grounding — the terminal output of a chat turn), or finish.
 */
export const ProposedAction = z.object({
  type: z.enum(["grounding", "learning", "respond", "finish"]),
  // grounding
  tool: z.string().optional(),
  args: z.record(z.string(), z.unknown()).optional(),
  // learning (write)
  memoryModuleId: z.string().optional(),
  record: z.record(z.string(), z.unknown()).optional(),
  // respond / finish
  message: z.string().optional(),
  result: z.string().optional(),
});
export type ProposedAction = z.infer<typeof ProposedAction>;

export const ActionProposal = z.object({
  /** Reasoning over working memory (the CoALA reasoning action). */
  thought: z.string(),
  action: ProposedAction,
});
export type ActionProposal = z.infer<typeof ActionProposal>;
