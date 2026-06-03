/**
 * @coala/runtime — Phase 2. Executes a CoALA blueprint's decision cycle (§4.6)
 * against an LLMProvider: retrieve → reason/propose → execute (grounding / learning / respond).
 */
export { AgentRuntime, type RuntimeOptions } from "./executor.js";
export { ToolRegistry, type ToolHandler, type ToolContext } from "./tools.js";
export {
  WorkingMemory,
  InMemoryStore,
  buildStores,
  moduleById,
} from "./memory.js";
export type { Store, Pointer, Record_, RecordMeta, RetrievalQuery } from "@coala/core";
export { EmbeddingIndex, cosine } from "./embedding.js";
export { ActionProposal, ProposedAction } from "./schema.js";
export { actionTargets, reasonRequest, type ActionTarget } from "./prompt.js";
export type { CycleStep, RetrievedItem, MemoryWrite, TurnResult } from "./trace.js";

// MCP / host-supplied tool execution.
export {
  buildTools,
  connectMcp,
  registerMcpClient,
  mcpHandler,
  parseToolResult,
  type McpLike,
  type BuildToolsOptions,
  type BuiltTools,
} from "./mcp.js";
