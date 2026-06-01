/**
 * @coala/providers — model-agnostic LLM abstraction.
 * Inference and (Phase 2) the runtime call agents through this interface so the
 * rest of the system never imports a vendor SDK directly (PLAN §6).
 */
export * from "./types.js";
export { BaseProvider, completeStructuredVia, extractJson } from "./structured.js";
export { createProvider } from "./factory.js";
export { credentialsFromEnv } from "./env.js";
export { MockProvider, whenIncludes, type MockRoute } from "./mock.js";
export { AnthropicProvider } from "./adapters/anthropic.js";
export { OpenAICompatibleProvider } from "./adapters/openai-compatible.js";
export { GoogleProvider } from "./adapters/google.js";
export {
  type EmbeddingProvider,
  type EmbeddingOptions,
  OpenAIEmbeddingProvider,
  LocalEmbeddingProvider,
  createEmbeddingProvider,
} from "./embeddings.js";
