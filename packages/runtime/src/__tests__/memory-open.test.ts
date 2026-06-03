import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../memory.js";
import { ToolRegistry } from "../tools.js";
import { registerMemoryOpen } from "../executor.js";

describe("memory.open tool", () => {
  it("opens a record body by moduleId + id", async () => {
    const stores = new Map([["m1", new InMemoryStore([{ fact: "zero" }, { fact: "one" }])]]);
    const reg = new ToolRegistry();
    registerMemoryOpen(reg, stores);
    const obs = await reg.run("memory.open", { moduleId: "m1", id: "1" }, { working: {} as any });
    expect(obs).toEqual({ fact: "one" });
  });

  it("returns an error for an unknown module", async () => {
    const reg = new ToolRegistry();
    registerMemoryOpen(reg, new Map());
    const obs = await reg.run("memory.open", { moduleId: "nope", id: "0" }, { working: {} as any });
    expect(obs).toMatchObject({ error: expect.stringContaining("nope") });
  });
});
