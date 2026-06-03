import { describe, it, expect } from "vitest";
import { slugify, assertInside } from "../paths.js";

describe("paths", () => {
  it("slugifies ids to safe filenames", () => {
    expect(slugify("Widget X / v2")).toBe("widget-x-v2");
    expect(slugify("2026-06-03T08:30")).toBe("2026-06-03t08-30");
  });

  it("accepts a path inside the root", () => {
    expect(() => assertInside("/agents/a", "/agents/a/scripts/x.py")).not.toThrow();
  });

  it("rejects a path that escapes the root", () => {
    expect(() => assertInside("/agents/a", "/agents/a/../b/x.py")).toThrow(/escapes/);
  });
});
