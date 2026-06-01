import { z } from "zod";
import { Id, ProviderName } from "./common.js";
import { MemoryModule } from "./memory.js";
import { AccessGrant, GroundingInterface } from "./action.js";
import { DecisionProcedure } from "./decision.js";

/** Per-agent LLM binding. The secret itself never lives here (PLAN §6b). */
export const ProviderConfig = z.object({
  provider: ProviderName,
  model: z.string().min(1),
  /** Optional sampling overrides. */
  temperature: z.number().min(0).max(2).optional(),
});
export type ProviderConfig = z.infer<typeof ProviderConfig>;

/**
 * The canonical CoALA Blueprint (PLAN §2). One Agent document fully describes a
 * language agent: its memory modules, internal + external action space, and
 * decision procedure. Every other package consumes this type.
 */
export const Agent = z.object({
  id: Id,
  name: z.string().min(1),
  /** The plain-English description the user wrote; inference reads from this. */
  naturalLanguageSpec: z.string().default(""),
  goals: z.array(z.string()).default([]),
  providerConfig: ProviderConfig,
  memoryModules: z.array(MemoryModule).default([]),
  /** External action space. */
  groundingInterfaces: z.array(GroundingInterface).default([]),
  /** Internal action space — read/write access per memory module. */
  accessPolicy: z.array(AccessGrant).default([]),
  decisionProcedure: DecisionProcedure,
  metadata: z
    .object({
      /** Set when this agent originated from a Table 2 preset. */
      preset: z.string().optional(),
      version: z.number().int().nonnegative().default(0),
    })
    .default({ version: 0 }),
});
export type Agent = z.infer<typeof Agent>;

/** Parse + validate an unknown value into a typed Agent, throwing on failure. */
export function parseAgent(input: unknown): Agent {
  return Agent.parse(input);
}
