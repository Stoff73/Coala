import { z } from "zod";
import { GroundingType, Id, RecordSchema, RetrievalMethod } from "./common.js";

/**
 * Internal action space (paper §4.3–4.5), expressed per memory module.
 * Retrieval = read LTM → working. Learning = write to LTM (add/modify/delete).
 * This object is exactly what the UI renders as the Access Matrix (PLAN §5).
 */
export const RetrievalGrant = z.object({
  enabled: z.boolean().default(false),
  method: RetrievalMethod.optional(),
});
export type RetrievalGrant = z.infer<typeof RetrievalGrant>;

export const LearningGrant = z.object({
  add: z.boolean().default(false),
  modify: z.boolean().default(false),
  /** "Unlearning" — deletion of memory items (paper §6, flagged risky). */
  delete: z.boolean().default(false),
});
export type LearningGrant = z.infer<typeof LearningGrant>;

export const AccessGrant = z.object({
  memoryModuleId: Id,
  retrieval: RetrievalGrant.default({ enabled: false }),
  learning: LearningGrant.default({ add: false, modify: false, delete: false }),
});
export type AccessGrant = z.infer<typeof AccessGrant>;

/** A digital tool / API the agent may call as an external action (paper §4.2). */
export const DigitalTool = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  /** Argument schema for the tool call, when defined. */
  inputSchema: RecordSchema.optional(),
});
export type DigitalTool = z.infer<typeof DigitalTool>;

/** One external interface the agent can act through (the external action space). */
/**
 * An MCP (Model Context Protocol) server backing a digital grounding interface.
 * When set, the interface's tools are executed by calling this server rather than
 * by host-implemented stubs — so exported agents can run real tools out of the box.
 */
export const McpServer = z.object({
  transport: z.enum(["stdio", "http"]),
  /** stdio: the command + args to spawn the server process. */
  command: z.string().optional(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).optional(),
  /** http: the server URL (streamable HTTP transport). */
  url: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
});
export type McpServer = z.infer<typeof McpServer>;

export const GroundingInterface = z.object({
  id: Id,
  type: GroundingType,
  name: z.string().min(1),
  description: z.string().default(""),
  /** Only meaningful for type === "digital". */
  digitalTools: z.array(DigitalTool).default([]),
  /**
   * Optional MCP server that implements this interface's tools (digital only).
   * If absent, tools are host-supplied (registered handlers / generated stubs).
   */
  mcp: McpServer.optional(),
});
export type GroundingInterface = z.infer<typeof GroundingInterface>;
