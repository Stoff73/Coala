import type { EmbeddingProvider } from "@coala/providers";
import type { Record_ } from "./memory.js";

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Vector retrieval over records using a real embedder + cosine similarity — the
 * substance of "embedding" retrieval (pgvector-style). Record vectors are cached
 * by content so repeated cycles only embed the query. Swap this for a pgvector
 * query in production; the ranking semantics are identical.
 */
export class EmbeddingIndex {
  private readonly cache = new Map<string, number[]>();

  constructor(private readonly embedder: EmbeddingProvider) {}

  private key(r: Record_): string {
    return JSON.stringify(r);
  }

  async rank(records: Record_[], query: string, k: number): Promise<Record_[]> {
    if (records.length === 0) return [];

    const missing = records.filter((r) => !this.cache.has(this.key(r)));
    if (missing.length) {
      const vecs = await this.embedder.embed(missing.map((r) => this.key(r)));
      missing.forEach((r, i) => this.cache.set(this.key(r), vecs[i]!));
    }

    const [qv] = await this.embedder.embed([query]);
    return records
      .map((r) => ({ r, score: cosine(qv!, this.cache.get(this.key(r))!) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map((x) => x.r);
  }
}
