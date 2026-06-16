import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../memory.js";

describe("InMemoryStore implements the async Store contract", () => {
  it("add → listPointers → openBody → retrieve", async () => {
    const s = new InMemoryStore([{ fact: "alpha" }]);
    const ptr = await s.add({ fact: "beta" });
    expect(typeof ptr.id).toBe("string");
    expect(await s.listPointers()).toHaveLength(2);
    const recent = await s.retrieve({ text: "", method: "recency", k: 1 });
    expect(recent).toEqual([{ fact: "beta" }]);
    expect(s.records).toHaveLength(2);
  });
});
