import type { Agent, MemoryModule } from "@coala/core";
import type { Store, Pointer, Record_, RecordMeta, RetrievalQuery } from "@coala/core";

// Re-export shared storage types from core so existing `@coala/runtime` imports keep working.
export type { Store, Pointer, Record_, RecordMeta, RetrievalQuery } from "@coala/core";

/** Short-term hub: variables carried across the decision cycle (paper §4.1). */
export class WorkingMemory {
  private data = new Map<string, unknown>();
  set(key: string, value: unknown): void { this.data.set(key, value); }
  get(key: string): unknown { return this.data.get(key); }
  snapshot(): Record_ { return Object.fromEntries(this.data); }
}

function tokens(s: string): string[] {
  return s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}
function relevanceScore(query: string, record: Record_): number {
  const q = new Set(tokens(query));
  return tokens(JSON.stringify(record)).filter((t) => q.has(t)).length;
}
function summarize(record: Record_): string {
  return Object.values(record).filter((v) => typeof v === "string" || typeof v === "number").slice(0, 3).map(String).join(" · ") || "(record)";
}

/** In-memory long-term store. Retrieval mirrors paper §4.3. Ephemeral default + test double. */
export class InMemoryStore implements Store {
  readonly records: Record_[];
  constructor(seed: Record_[] = []) { this.records = [...seed]; }

  async add(record: Record_, _meta?: RecordMeta): Promise<Pointer> {
    this.records.push(record);
    const id = String(this.records.length - 1);
    return { id, summary: summarize(record), meta: {} };
  }
  async listPointers(): Promise<Pointer[]> {
    return this.records.map((r, i) => ({ id: String(i), summary: summarize(r), meta: r }));
  }
  async openBody(id: string): Promise<Record_ | undefined> {
    const i = Number(id);
    return Number.isInteger(i) ? this.records[i] : undefined;
  }
  async retrieve(q: RetrievalQuery): Promise<Record_[]> {
    const k = q.k;
    switch (q.method) {
      case "recency": return this.records.slice(-k).reverse();
      case "importance": return [...this.records].sort((a, b) => Number(b.importance ?? 0) - Number(a.importance ?? 0)).slice(0, k);
      case "relevance":
      case "embedding":
        return [...this.records].map((r) => ({ r, s: relevanceScore(q.text, r) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, k).map((x) => x.r);
      case "rule": return this.records.slice(0, k);
    }
  }
}

/** Build an in-memory store for each long-term module (seeded from the blueprint). */
export function buildStores(agent: Agent): Map<string, Store> {
  const stores = new Map<string, Store>();
  for (const m of agent.memoryModules) {
    if (m.kind === "episodic" || m.kind === "semantic" || m.kind === "procedural") {
      stores.set(m.id, new InMemoryStore(m.records.map((r) => r.data as Record_)));
    }
  }
  return stores;
}

export function moduleById(agent: Agent, id: string): MemoryModule | undefined {
  return agent.memoryModules.find((m) => m.id === id);
}
