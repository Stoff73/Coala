import type { ProviderConfig, ProviderName } from "@coala/core";
import { AnthropicProvider } from "./adapters/anthropic.js";
import { GoogleProvider } from "./adapters/google.js";
import { OpenAICompatibleProvider } from "./adapters/openai-compatible.js";
import { type LLMProvider, type ProviderCredentials, ProviderError } from "./types.js";

const OPENAI_COMPATIBLE_DEFAULTS: Partial<Record<ProviderName, string>> = {
  openai: "https://api.openai.com/v1",
  xai: "https://api.x.ai/v1",
  ollama: "http://localhost:11434/v1",
};

/**
 * Build a provider from a per-agent {@link ProviderConfig} plus injected credentials.
 * Credentials are resolved server-side (see {@link credentialsFromEnv}); they never
 * reach the browser (PLAN §6b).
 */
export function createProvider(
  config: ProviderConfig,
  creds: ProviderCredentials,
): LLMProvider {
  switch (config.provider) {
    case "anthropic":
      return new AnthropicProvider(creds);
    case "google":
      return new GoogleProvider(creds);
    case "openai":
    case "xai":
    case "ollama": {
      const baseUrl = creds.baseUrl ?? OPENAI_COMPATIBLE_DEFAULTS[config.provider]!;
      return new OpenAICompatibleProvider(config.provider, baseUrl, creds);
    }
    case "local": {
      if (!creds.baseUrl) {
        throw new ProviderError(
          "The `local` provider requires a baseUrl (set LOCAL_LLM_BASE_URL).",
          "local",
        );
      }
      return new OpenAICompatibleProvider("local", creds.baseUrl, creds);
    }
    default: {
      const exhaustive: never = config.provider;
      throw new ProviderError(`Unknown provider: ${String(exhaustive)}`, "local");
    }
  }
}
