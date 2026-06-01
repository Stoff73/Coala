import type { ProviderName } from "@coala/core";
import type { ProviderCredentials } from "./types.js";

/**
 * Resolve provider credentials from server-side environment variables (PLAN §6b).
 * SERVER ONLY — never import this into client/browser code; secrets must not ship
 * to the client. `apps/web` calls this inside Route Handlers / Server Actions.
 */
export function credentialsFromEnv(
  provider: ProviderName,
  env: NodeJS.ProcessEnv = process.env,
): ProviderCredentials {
  switch (provider) {
    case "anthropic":
      return { apiKey: env.ANTHROPIC_API_KEY };
    case "openai":
      return { apiKey: env.OPENAI_API_KEY, baseUrl: env.OPENAI_BASE_URL };
    case "xai":
      return { apiKey: env.XAI_API_KEY, baseUrl: env.XAI_BASE_URL };
    case "google":
      return { apiKey: env.GOOGLE_API_KEY ?? env.GEMINI_API_KEY };
    case "ollama":
      return { apiKey: env.OLLAMA_API_KEY, baseUrl: env.OLLAMA_BASE_URL };
    case "local":
      return { apiKey: env.LOCAL_LLM_API_KEY, baseUrl: env.LOCAL_LLM_BASE_URL };
    default: {
      const exhaustive: never = provider;
      throw new Error(`Unknown provider: ${String(exhaustive)}`);
    }
  }
}
