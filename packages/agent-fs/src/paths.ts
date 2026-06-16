import { resolve, relative, isAbsolute } from "node:path";

/** Lowercase, hyphenate, strip unsafe characters → a portable filename stem. */
export function slugify(id: string): string {
  return id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/^-+|-+$/g, "");
}

/** Throw if `target` resolves outside `root` (path-traversal guard). */
export function assertInside(root: string, target: string): void {
  const r = resolve(root);
  const t = resolve(r, target);
  const rel = relative(r, t);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Path "${target}" escapes the agent root "${root}".`);
  }
}
