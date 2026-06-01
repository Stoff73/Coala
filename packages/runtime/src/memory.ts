import type { Agent, MemoryModule, RetrievalMethod } from "@coala/core";

export type Record_ = Record<string, unknown>;

/** Short-term hub: variables carried across the decision cycle (paper §4.1). */
export class WorkingMemory {
  private data = new Map<string, unknown>();

  set(key: string, value: unknown): void {
    this.data.set(key, value);
  }
  get(key: string): unknown {
    return this.data.get(key);
  }
  snapshot(): Record_ {
    return Object.fromEntries(this.data);
  }
}

export interface RetrievalQuery {
  text: string;
  method: RetrievalMethod;
  k: number;
}

function tokens(s: string): string[] {
  return s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/** Keyword-overlap score — a dependency-free stand-in for embedding similarity. */
function relevanceScore(query: string, record: Record_): number {
  const q = new Set(tokens(query));
  const r = tokens(JSON.stringify(record));
  let hits = 0;
  for (const t of r) if (q.has(t)) hits++;
  return hits;
}

/**
 * In-memory long-term store. Retrieval methods mirror the paper (§4.3):
 * recency, importance, relevance/embedding (keyword overlap here), and rule.
 */
export class InMemoryStore {
  readonly records: Record_[];

  constructor(seed: Record_[] = []) {
    this.records = [...seed];
  }

  add(record: Record_): void {
    this.records.push(record);
  }

  retrieve(q: RetrievalQuery): Record_[] {
    const k = q.k;
    switch (q.method) {
      case "recency":
        return this.records.slice(-k).reverse();
      case "importance":
        return [...this.records]
          .sort((a, b) => Number(b.importance ?? 0) - Number(a.importance ?? 0))
          .slice(0, k);
      case "relevance":
      case "embedding":
        return [...this.records]
          .map((r) => ({ r, s: relevanceScore(q.text, r) }))
          .filter((x) => x.s > 0)
          .sort((a, b) => b.s - a.s)
          .slice(0, k)
          .map((x) => x.r);
      case "rule":
        return this.records.slice(0, k);
    }
  }
}

/** Build a store for each long-term module that holds records (seeded from the blueprint). */
export function buildStores(agent: Agent): Map<string, InMemoryStore> {
  const stores = new Map<string, InMemoryStore>();
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
