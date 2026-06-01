import type { ProviderName } from "@coala/core";
import { BaseProvider } from "../structured.js";
import {
  type CompletionRequest,
  type CompletionResponse,
  type ProviderCredentials,
  ProviderError,
} from "../types.js";

const DEFAULT_BASE = "https://api.anthropic.com/v1";

/** Anthropic Messages API adapter, with prompt caching on the system block. */
export class AnthropicProvider extends BaseProvider {
  readonly name: ProviderName = "anthropic";
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly baseUrl: string;

  constructor(private readonly creds: ProviderCredentials) {
    super();
    this.fetchImpl = creds.fetch ?? globalThis.fetch;
    this.baseUrl = creds.baseUrl ?? DEFAULT_BASE;
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    if (!this.creds.apiKey) {
      throw new ProviderError("Missing Anthropic API key", this.name);
    }

    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.maxTokens ?? 2048,
      messages: req.messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role, content: m.content })),
    };
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.system) {
      // cache_control marks the (often-large, stable) system prompt as cacheable.
      body.system = [
        { type: "text", text: req.system, cache_control: { type: "ephemeral" } },
      ];
    }

    const res = await this.fetchImpl(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.creds.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new ProviderError(
        `Anthropic ${res.status}: ${await res.text()}`,
        this.name,
        res.status,
      );
    }

    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = (data.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
    return { text, raw: data };
  }
}
