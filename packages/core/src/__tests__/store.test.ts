import { describe, it, expect } from "vitest";
import type { Store, Pointer, Record_, RetrievalQuery, RecordMeta } from "../runtime/store.js";

// A minimal in-test implementation proves the interface is usable/coherent.
class ArrayStore implements Store {
  private recs: Record_[] = [];
  async listPointers(): Promise<Pointer[]> {
    return this.recs.map((r, i) => ({ id: String(i), summary: JSON.stringify(r), meta: r }));
  }
  async openBody(id: string): Promise<Record_ | undefined> {
    return this.recs[Number(id)];
  }
  async retrieve(_q: RetrievalQuery): Promise<Record_[]> {
    return this.recs;
  }
  async add(record: Record_, _meta?: RecordMeta): Promise<Pointer> {
    this.recs.push(record);
    return { id: String(this.recs.length - 1), summary: JSON.stringify(record), meta: record };
  }
}

describe("Store contract", () => {
  it("supports add → listPointers → openBody → retrieve", async () => {
    const s = new ArrayStore();
    const ptr = await s.add({ a: 1 });
    expect(ptr.id).toBe("0");
    expect(await s.listPointers()).toHaveLength(1);
    expect(await s.openBody("0")).toEqual({ a: 1 });
    expect(await s.retrieve({ text: "x", method: "recency", k: 5 })).toHaveLength(1);
  });

  it("openBody returns undefined for an unknown id", async () => {
    const s = new ArrayStore();
    expect(await s.openBody("999")).toBeUndefined();
  });
});
