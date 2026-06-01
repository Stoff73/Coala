import type { ProviderCredentials } from "./types.js";

/** Produces dense vectors for text — the basis of real (pgvector-style) retrieval. */
export interface EmbeddingProvider {
  readonly name: string;
  embed(texts: string[]): Promise<number[][]>;
}

const OPENAI_COMPATIBLE_BASES: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  xai: "https://api.x.ai/v1",
};

/** Real embeddings via an OpenAI-compatible `/embeddings` endpoint. */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = "openai";
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly baseUrl: string;

  constructor(
    private readonly creds: ProviderCredentials,
    private readonly model = "text-embedding-3-small",
    base = "https://api.openai.com/v1",
  ) {
    this.fetchImpl = creds.fetch ?? globalThis.fetch;
    this.baseUrl = creds.baseUrl ?? base;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.creds.apiKey) throw new Error("Missing API key for embeddings.");
    const res = await this.fetchImpl(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.creds.apiKey}` },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!res.ok) throw new Error(`Embeddings ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
    return data.data.map((d) => d.embedding);
  }
}

function tokens(s: string): string[] {
  return s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}
function trigrams(s: string): string[] {
  const x = ` ${s.toLowerCase()} `;
  const out: string[] = [];
  for (let i = 0; i < x.length - 2; i++) out.push(x.slice(i, i + 3));
  return out;
}
function fnv1a(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Deterministic, dependency-free embedder: L2-normalized feature-hashed bag of
 * tokens + character trigrams. No network/key — used offline and in tests. Cosine
 * over these vectors captures lexical (incl. partial/fuzzy) similarity. For genuine
 * semantic similarity, use {@link OpenAIEmbeddingProvider}.
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly name = "local";
  constructor(private readonly dims = 256) {}

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.vec(t));
  }

  private vec(text: string): number[] {
    const v = new Array(this.dims).fill(0);
    for (const f of [...tokens(text), ...trigrams(text)]) v[fnv1a(f) % this.dims] += 1;
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return v.map((x) => x / norm);
  }
}

export interface EmbeddingOptions {
  provider?: "openai" | "xai" | "local";
  model?: string;
  creds?: ProviderCredentials;
}

/** Build an embedder. Defaults to the deterministic local embedder (no key needed). */
export function createEmbeddingProvider(opts: EmbeddingOptions = {}): EmbeddingProvider {
  const provider = opts.provider ?? "local";
  if (provider === "local") return new LocalEmbeddingProvider();
  const base = OPENAI_COMPATIBLE_BASES[provider] ?? "https://api.openai.com/v1";
  return new OpenAIEmbeddingProvider(opts.creds ?? {}, opts.model ?? "text-embedding-3-small", base);
}
