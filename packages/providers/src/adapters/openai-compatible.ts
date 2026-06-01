import type { ProviderName } from "@coala/core";
import { BaseProvider } from "../structured.js";
import {
  type CompletionRequest,
  type CompletionResponse,
  type ProviderCredentials,
  ProviderError,
} from "../types.js";

/**
 * Adapter for any OpenAI Chat Completions–compatible endpoint.
 * Covers `openai`, `xai` (Grok), `ollama`, and `local` — they differ only by base URL.
 */
export class OpenAICompatibleProvider extends BaseProvider {
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(
    readonly name: ProviderName,
    private readonly baseUrl: string,
    private readonly creds: ProviderCredentials,
  ) {
    super();
    this.fetchImpl = creds.fetch ?? globalThis.fetch;
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const messages = [
      ...(req.system ? [{ role: "system", content: req.system }] : []),
      ...req.messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    const body: Record<string, unknown> = { model: req.model, messages };
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;

    const headers: Record<string, string> = { "content-type": "application/json" };
    // Ollama/local may not require a key; others do.
    if (this.creds.apiKey) headers.authorization = `Bearer ${this.creds.apiKey}`;

    const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new ProviderError(
        `${this.name} ${res.status}: ${await res.text()}`,
        this.name,
        res.status,
      );
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content ?? "";
    return { text, raw: data };
  }
}
