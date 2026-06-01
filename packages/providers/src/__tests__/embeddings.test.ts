import { describe, expect, it } from "vitest";
import { LocalEmbeddingProvider, createEmbeddingProvider } from "../embeddings.js";

function cosine(a: number[], b: number[]): number {
  let d = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    d += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return d / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

describe("LocalEmbeddingProvider", () => {
  it("is deterministic and L2-normalized", async () => {
    const e = new LocalEmbeddingProvider();
    const [a] = await e.embed(["running shoes"]);
    const [b] = await e.embed(["running shoes"]);
    expect(a).toEqual(b);
    const norm = Math.sqrt(a!.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it("ranks lexically-similar text closer by cosine", async () => {
    const e = new LocalEmbeddingProvider();
    const [q, near, far] = await e.embed(["running shoes", "shoes for running", "blue leather boots"]);
    expect(cosine(q!, near!)).toBeGreaterThan(cosine(q!, far!));
  });
});

describe("createEmbeddingProvider", () => {
  it("defaults to the local embedder (no key needed)", () => {
    expect(createEmbeddingProvider().name).toBe("local");
  });
  it("builds an OpenAI embedder when requested", () => {
    expect(createEmbeddingProvider({ provider: "openai", creds: { apiKey: "k" } }).name).toBe("openai");
  });
});
