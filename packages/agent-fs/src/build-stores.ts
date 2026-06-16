import { join } from "node:path";
import type { Agent, Store } from "@coala/core";
import { FileStore } from "./file-store.js";
import { slugify } from "./paths.js";

/** Build a FileStore for each long-term module, rooted at the agent folder's memory tree. */
export function buildFileStores(root: string, agent: Agent): Map<string, Store> {
  const stores = new Map<string, Store>();
  for (const m of agent.memoryModules) {
    if (m.kind === "working") continue;
    const dir = join(root, "memory", m.kind, slugify(m.id));
    stores.set(m.id, new FileStore(dir, { name: m.name, kind: m.kind }));
  }
  return stores;
}
