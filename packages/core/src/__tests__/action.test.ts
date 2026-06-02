import { describe, expect, it } from "vitest";
import { DigitalTool } from "../schema/action.js";

describe("DigitalTool.sideEffect", () => {
  it("accepts a valid side-effect class", () => {
    const t = DigitalTool.parse({ name: "deleteRecord", sideEffect: "destructive" });
    expect(t.sideEffect).toBe("destructive");
  });

  it("leaves sideEffect undefined when omitted", () => {
    const t = DigitalTool.parse({ name: "searchCatalog" });
    expect(t.sideEffect).toBeUndefined();
  });

  it("rejects an unknown side-effect value", () => {
    expect(() => DigitalTool.parse({ name: "x", sideEffect: "nuke" })).toThrow();
  });
});
