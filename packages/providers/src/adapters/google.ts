import type { ProviderName } from "@coala/core";
import { BaseProvider } from "../structured.js";
import {
  type CompletionRequest,
  type CompletionResponse,
  type ProviderCredentials,
  ProviderError,
} from "../types.js";

const DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta";

/** Google Gemini (generateContent) adapter. */
export class GoogleProvider extends BaseProvider {
  readonly name: ProviderName = "google";
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly baseUrl: string;

  constructor(private readonly creds: ProviderCredentials) {
    super();
    this.fetchImpl = creds.fetch ?? globalThis.fetch;
    this.baseUrl = creds.baseUrl ?? DEFAULT_BASE;
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    if (!this.creds.apiKey) {
      throw new ProviderError("Missing Google API key", this.name);
    }

    const contents = req.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        // Gemini uses "model" rather than "assistant".
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    const body: Record<string, unknown> = { contents };
    if (req.system) body.systemInstruction = { parts: [{ text: req.system }] };
    const generationConfig: Record<string, unknown> = {};
    if (req.temperature !== undefined) generationConfig.temperature = req.temperature;
    if (req.maxTokens !== undefined) generationConfig.maxOutputTokens = req.maxTokens;
    if (Object.keys(generationConfig).length) body.generationConfig = generationConfig;

    const url = `${this.baseUrl}/models/${req.model}:generateContent?key=${this.creds.apiKey}`;
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new ProviderError(
        `Google ${res.status}: ${await res.text()}`,
        this.name,
        res.status,
      );
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text =
      data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    return { text, raw: data };
  }
}
