import { describe, it, expect } from "vitest";
import { parseFrontmatter, stringifyFrontmatter } from "../frontmatter.js";

describe("frontmatter", () => {
  it("parses YAML frontmatter + markdown body", () => {
    const src = "---\nid: widget-x\nimportance: 0.8\n---\nWidget X notes.\n";
    const { data, body } = parseFrontmatter(src);
    expect(data).toEqual({ id: "widget-x", importance: 0.8 });
    expect(body).toBe("Widget X notes.\n");
  });

  it("treats a file with no frontmatter as all body", () => {
    const { data, body } = parseFrontmatter("just text");
    expect(data).toEqual({});
    expect(body).toBe("just text");
  });

  it("parses frontmatter from a CRLF file", () => {
    const src = "---\r\nid: x\r\n---\r\nbody\r\n";
    const { data, body } = parseFrontmatter(src);
    expect(data).toEqual({ id: "x" });
    expect(body).toBe("body\n");
  });

  it("round-trips", () => {
    const out = stringifyFrontmatter({ id: "a", n: 1 }, "Body here.");
    const { data, body } = parseFrontmatter(out);
    expect(data).toEqual({ id: "a", n: 1 });
    expect(body).toBe("Body here.");
  });
});
