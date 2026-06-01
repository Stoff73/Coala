import { z } from "zod";
import {
  BackingStoreType,
  Id,
  MemoryKind,
  RecordSchema,
  RetrievalMethod,
} from "./common.js";

/** Provenance of a stored record. */
export const RecordSource = z.enum(["seed", "inferred", "runtime"]);
export type RecordSource = z.infer<typeof RecordSource>;

/** One item of content held inside a memory module (record-level CRUD). */
export const MemoryRecord = z.object({
  id: Id,
  /** Validated at the app layer against the owning module's RecordSchema. */
  data: z.record(z.string(), z.unknown()).default({}),
  source: RecordSource.default("seed"),
});
export type MemoryRecord = z.infer<typeof MemoryRecord>;

/** How this module is read into working memory (paper §4.3). */
export const RetrievalConfig = z.object({
  method: RetrievalMethod,
  /** Number of records to pull per retrieval, when applicable. */
  k: z.number().int().positive().optional(),
});
export type RetrievalConfig = z.infer<typeof RetrievalConfig>;

export const BackingStore = z.object({
  type: BackingStoreType,
  detail: z.string().optional(),
});
export type BackingStore = z.infer<typeof BackingStore>;

/** A reusable prompt template held in procedural memory. */
export const ProceduralTemplate = z.object({
  name: z.string().min(1),
  content: z.string().default(""),
});
export type ProceduralTemplate = z.infer<typeof ProceduralTemplate>;

/** A code-based skill (Voyager-style) held in procedural memory. */
export const ProceduralSkill = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  code: z.string().default(""),
});
export type ProceduralSkill = z.infer<typeof ProceduralSkill>;

/** Editable contents of procedural memory — the agent's prompt templates + skills. */
export const ProceduralContent = z.object({
  templates: z.array(ProceduralTemplate).default([]),
  skills: z.array(ProceduralSkill).default([]),
});
export type ProceduralContent = z.infer<typeof ProceduralContent>;

/** One scoring dimension of an episode rubric. */
export const RubricCriterion = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
});
export type RubricCriterion = z.infer<typeof RubricCriterion>;

/**
 * Editable rubric for recording + scoring episodes in episodic memory. The episode
 * record fields come from the module's `schema`; this adds scoring + reflection.
 */
export const EpisodeRubric = z.object({
  criteria: z.array(RubricCriterion).default([]),
  reflectionPrompts: z.array(z.string()).default([]),
});
export type EpisodeRubric = z.infer<typeof EpisodeRubric>;

/**
 * A single CoALA memory store (module-level CRUD). The triad the UI exposes:
 *   module (this object) → schema (the "model") → records (its contents).
 */
export const MemoryModule = z.object({
  id: Id,
  kind: MemoryKind,
  name: z.string().min(1),
  description: z.string().default(""),
  /** Why the inference engine proposed this module — drives the self-explaining UI. */
  rationale: z.string().optional(),
  /** The record "model". Optional for working/procedural which may be unstructured. */
  schema: RecordSchema.optional(),
  /** Default retrieval behaviour for this store (LTM only). */
  retrievalConfig: RetrievalConfig.optional(),
  backingStore: BackingStore,
  records: z.array(MemoryRecord).default([]),
  /** Procedural modules only — editable prompt templates + skills. */
  procedural: ProceduralContent.optional(),
  /** Episodic modules only — editable episode-recording/scoring rubric. */
  rubric: EpisodeRubric.optional(),
});
export type MemoryModule = z.infer<typeof MemoryModule>;
