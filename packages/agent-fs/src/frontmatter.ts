import YAML from "yaml";

export interface Parsed {
  data: Record<string, unknown>;
  body: string;
}

const FM = /^---\n([\s\S]*?)\n---\n?/;

/** Split a "YAML frontmatter + markdown body" string. No frontmatter → all body. */
export function parseFrontmatter(src: string): Parsed {
  // Normalize CRLF so Windows-edited files still parse.
  src = src.replace(/\r\n/g, "\n");
  const m = FM.exec(src);
  if (!m) return { data: {}, body: src };
  const data = (YAML.parse(m[1]) ?? {}) as Record<string, unknown>;
  return { data, body: src.slice(m[0].length) };
}

/** Serialize frontmatter + body. A trailing newline is ensured after the fence. */
export function stringifyFrontmatter(data: Record<string, unknown>, body = ""): string {
  const yaml = YAML.stringify(data).trimEnd();
  return `---\n${yaml}\n---\n${body}`;
}
