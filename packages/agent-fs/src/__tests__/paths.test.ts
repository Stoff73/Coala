import { describe, it, expect } from "vitest";
import { slugify, assertInside } from "../paths.js";

describe("paths", () => {
  it("slugifies ids to safe filenames", () => {
    expect(slugify("Widget X / v2")).toBe("widget-x-v2");
    expect(slugify("2026-06-03T08:30")).toBe("2026-06-03t08-30");
  });

  it("slugify trims a trailing hyphen even after the 80-char cap", () => {
    expect(slugify("a".repeat(79) + "!bbb").endsWith("-")).toBe(false);
  });
  it("slugify returns empty string for all-symbol input", () => {
    expect(slugify("///")).toBe("");
  });

  it("accepts a path inside the root", () => {
    expect(() => assertInside("/agents/a", "/agents/a/scripts/x.py")).not.toThrow();
  });

  it("rejects a path that escapes the root", () => {
    expect(() => assertInside("/agents/a", "/agents/a/../b/x.py")).toThrow(/escapes/);
  });

  it("assertInside rejects a sibling dir sharing a prefix", () => {
    expect(() => assertInside("/agents/a", "/agents/ab/evil")).toThrow(/escapes/);
  });
  it("assertInside rejects an absolute path outside root", () => {
    expect(() => assertInside("/agents/a", "/etc/passwd")).toThrow(/escapes/);
  });
  it("assertInside rejects a relative escape", () => {
    expect(() => assertInside("/agents/a", "../../etc/passwd")).toThrow(/escapes/);
  });
  it("assertInside allows the root itself and in-bounds traversal", () => {
    expect(() => assertInside("/agents/a", "/agents/a")).not.toThrow();
    expect(() => assertInside("/agents/a", "scripts/../scripts/x")).not.toThrow();
  });
});
