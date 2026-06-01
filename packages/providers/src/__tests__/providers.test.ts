import { describe, expect, it } from "vitest";
import { z } from "zod";
import { extractJson } from "../structured.js";
import { MockProvider } from "../mock.js";
import { createProvider } from "../factory.js";
import { AnthropicProvider } from "../adapters/anthropic.js";
import { OpenAICompatibleProvider } from "../adapters/openai-compatible.js";

describe("extractJson", () => {
  it("strips ```json fences", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it("narrows to the outermost object amid prose", () => {
    expect(extractJson('Sure! {"a":1} hope that helps')).toBe('{"a":1}');
  });
  it("handles arrays", () => {
    expect(extractJson("here: [1, 2, 3]")).toBe("[1, 2, 3]");
  });
});

describe("completeStructured (generic flow)", () => {
  const schema = z.object({ answer: z.number() });

  it("parses + validates a good response", async () => {
    const p = new MockProvider([{ match: () => true, text: '{"answer": 42}' }]);
    const out = await p.completeStructured({ model: "m", messages: [{ role: "user", content: "?" }] }, schema);
    expect(out.answer).toBe(42);
  });

  it("retries when the first response is invalid, then succeeds", async () => {
    let n = 0;
    const p = new MockProvider([
      {
        match: () => true,
        text: () => (n++ === 0 ? '{"answer": "not a number"}' : '{"answer": 7}'),
      },
    ]);
    const out = await p.completeStructured(
      { model: "m", messages: [{ role: "user", content: "?" }] },
      schema,
      { maxAttempts: 2 },
    );
    expect(out.answer).toBe(7);
    expect(p.calls.length).toBe(2);
  });

  it("throws after exhausting attempts", async () => {
    const p = new MockProvider([{ match: () => true, text: "{}" }]);
    await expect(
      p.completeStructured({ model: "m", messages: [{ role: "user", content: "?" }] }, schema, {
        maxAttempts: 2,
      }),
    ).rejects.toThrow(/Structured output failed/);
  });
});

describe("createProvider factory", () => {
  it("maps provider names to the right adapters", () => {
    expect(createProvider({ provider: "anthropic", model: "x" }, { apiKey: "k" })).toBeInstanceOf(
      AnthropicProvider,
    );
    expect(createProvider({ provider: "xai", model: "x" }, { apiKey: "k" })).toBeInstanceOf(
      OpenAICompatibleProvider,
    );
    expect(createProvider({ provider: "openai", model: "x" }, { apiKey: "k" })).toBeInstanceOf(
      OpenAICompatibleProvider,
    );
  });

  it("requires a baseUrl for the local provider", () => {
    expect(() => createProvider({ provider: "local", model: "x" }, {})).toThrow(/baseUrl/);
  });
});
