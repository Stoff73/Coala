import type { ProviderName } from "@coala/core";
import type { z, ZodTypeAny } from "zod";

export type Role = "system" | "user" | "assistant";

export interface Message {
  role: Role;
  content: string;
}

export interface CompletionRequest {
  model: string;
  messages: Message[];
  /** Optional system prompt; adapters place it in the provider-appropriate slot. */
  system?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface CompletionResponse {
  text: string;
  /** Raw provider payload, for debugging/telemetry. */
  raw?: unknown;
}

export interface StructuredOptions {
  /** How many times to re-ask the model when its JSON fails schema validation. */
  maxAttempts?: number;
}

/**
 * The single abstraction every other package depends on. Secrets are injected via
 * {@link ProviderCredentials} at construction time and never live on the agent (PLAN §6b).
 */
export interface LLMProvider {
  readonly name: ProviderName;
  /** Free-text completion. */
  complete(req: CompletionRequest): Promise<CompletionResponse>;
  /** Completion constrained to a zod schema; validated (with retries) before returning. */
  completeStructured<S extends ZodTypeAny>(
    req: CompletionRequest,
    schema: S,
    opts?: StructuredOptions,
  ): Promise<z.infer<S>>;
}

/** Injected secrets/config — sourced server-side from env (PLAN §6b). */
export interface ProviderCredentials {
  apiKey?: string;
  /** Override the API base URL (required for `local`, customises others). */
  baseUrl?: string;
  /** Inject a fetch implementation (tests, proxies). Defaults to global fetch. */
  fetch?: typeof globalThis.fetch;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly provider: ProviderName,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
