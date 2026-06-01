import { z } from "zod";

/**
 * CoALA memory taxonomy (paper §4.1).
 * - working:    short-term hub that persists across LLM calls within a decision cycle
 * - episodic:   past experiences / trajectories
 * - semantic:   facts about the world and the agent itself
 * - procedural: the LLM (implicit) + agent code: prompt templates, parsers, skills
 */
export const MemoryKind = z.enum(["working", "episodic", "semantic", "procedural"]);
export type MemoryKind = z.infer<typeof MemoryKind>;

/** Long-term memory kinds — the stores that Retrieval reads and Learning writes. */
export const LONG_TERM_KINDS = ["episodic", "semantic", "procedural"] as const;

/** External action space (paper §4.2). */
export const GroundingType = z.enum(["dialogue", "physical", "digital"]);
export type GroundingType = z.infer<typeof GroundingType>;

/** Retrieval strategies for reading LTM into working memory (paper §4.3). */
export const RetrievalMethod = z.enum([
  "recency",
  "importance",
  "relevance",
  "embedding",
  "rule",
]);
export type RetrievalMethod = z.infer<typeof RetrievalMethod>;

/** Decision-procedure archetypes (paper §4.6, Table 2). */
export const DecisionStyle = z.enum([
  "react",
  "tot",
  "reflexion",
  "generative-agents",
  "saycan",
  "custom",
]);
export type DecisionStyle = z.infer<typeof DecisionStyle>;

/** Where a memory module is physically backed at runtime (Phase 2). */
export const BackingStoreType = z.enum([
  "inline", // seed/records stored in the blueprint itself
  "kv", // key/value (typical for working memory)
  "relational", // relational table
  "pgvector", // embedding store (typical for semantic/episodic)
  "code", // source files / skill library (procedural)
]);
export type BackingStoreType = z.infer<typeof BackingStoreType>;

/** Model-agnostic provider binding (PLAN §6b). Secrets stay server-side; this only names the model. */
export const ProviderName = z.enum([
  "anthropic",
  "openai",
  "xai",
  "google",
  "ollama",
  "local",
]);
export type ProviderName = z.infer<typeof ProviderName>;

/** Primitive field types for a memory record's schema (the "memory model"). */
export const FieldType = z.enum([
  "string",
  "number",
  "boolean",
  "datetime",
  "json",
  "vector",
  "ref",
]);
export type FieldType = z.infer<typeof FieldType>;

export const Field = z.object({
  name: z.string().min(1),
  type: FieldType,
  description: z.string().optional(),
  required: z.boolean().default(false),
});
export type Field = z.infer<typeof Field>;

/**
 * The shape of a single record inside a memory module — what the UI calls the
 * "memory model". Editing this is module-schema CRUD; editing records is record CRUD.
 */
export const RecordSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  fields: z.array(Field).default([]),
});
export type RecordSchema = z.infer<typeof RecordSchema>;

/** Stable identifier helper — slugs used to cross-reference modules from access grants. */
export const Id = z.string().min(1);
export type Id = z.infer<typeof Id>;
