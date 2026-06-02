import { describe, expect, it } from "vitest";
import { DigitalTool } from "../schema/action.js";

describe("DigitalTool.sideEffect", () => {
  it.each(["read", "write", "destructive"] as const)("accepts the %s side-effect class", (effect) => {
    const t = DigitalTool.parse({ name: "tool", sideEffect: effect });
    expect(t.sideEffect).toBe(effect);
  });

  it("leaves sideEffect undefined when omitted", () => {
    const t = DigitalTool.parse({ name: "searchCatalog" });
    expect(t.sideEffect).toBeUndefined();
  });

  it("rejects an unknown side-effect value", () => {
    expect(() => DigitalTool.parse({ name: "x", sideEffect: "nuke" })).toThrow();
  });
});
