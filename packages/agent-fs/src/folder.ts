import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { parseAgent, MemoryModule, LONG_TERM_KINDS, type Agent } from "@coala/core";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.js";
import { reindexModule } from "./reindex.js";
import { slugify } from "./paths.js";

type LtKind = (typeof LONG_TERM_KINDS)[number];

/** Path used in agent.md to reference a module: `<kind>/<slug>`. */
function modulePath(m: MemoryModule): string {
  return `${m.kind}/${slugify(m.id)}`;
}

export async function saveAgentFolder(root: string, agent: Agent): Promise<void> {
  await mkdir(join(root, "memory"), { recursive: true });

  const idToPath = new Map(agent.memoryModules.map((m) => [m.id, modulePath(m)] as const));

  const frontmatter = {
    coalaVersion: 1,
    id: agent.id,
    name: agent.name,
    goals: agent.goals,
    provider: agent.providerConfig,
    decisionProcedure: agent.decisionProcedure,
    grounding: agent.groundingInterfaces,
    metadata: agent.metadata,
    // Working memory is runtime-only state with no folder; carry it in the manifest so the
    // round-trip stays lossless (it is reconstructed verbatim on load).
    workingMemory: agent.memoryModules.filter((m) => m.kind === "working"),
    accessPolicy: agent.accessPolicy.map((a) => ({
      module: idToPath.get(a.memoryModuleId) ?? a.memoryModuleId,
      retrieval: a.retrieval,
      learning: a.learning,
    })),
  };
  await writeFile(
    join(root, "agent.md"),
    stringifyFrontmatter(frontmatter, `# ${agent.name}\n\n${agent.naturalLanguageSpec}\n`),
  );

  // Guard: two same-kind modules whose ids slugify to the same folder would silently
  // overwrite each other. Detect collisions up-front and fail with a clear message.
  const seenSlugs = new Map<string, string>(); // "<kind>/<slug>" -> original id
  for (const m of agent.memoryModules) {
    if (!LONG_TERM_KINDS.includes(m.kind as LtKind)) continue;
    const key = `${m.kind}/${slugify(m.id)}`;
    if (seenSlugs.has(key)) {
      throw new Error(
        `Two "${m.kind}" memory modules map to the same folder "${slugify(m.id)}": "${seenSlugs.get(key)}" and "${m.id}". Rename one so they differ.`,
      );
    }
    seenSlugs.set(key, m.id);
  }

  for (const m of agent.memoryModules) {
    if (!LONG_TERM_KINDS.includes(m.kind as LtKind)) continue; // working memory has no folder
    const dir = join(root, "memory", m.kind, slugify(m.id));
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "_meta.yaml"),
      YAML.stringify({
        id: m.id,
        name: m.name,
        description: m.description,
        rationale: m.rationale,
        retrievalConfig: m.retrievalConfig,
        backingStore: m.backingStore,
      }),
    );
    if (m.schema) await writeFile(join(dir, "_schema.yaml"), YAML.stringify(m.schema));
    if (m.rubric) await writeFile(join(dir, "_rubric.yaml"), YAML.stringify(m.rubric));
    if (m.procedural) await writeFile(join(dir, "_procedural.yaml"), YAML.stringify(m.procedural));
    const seenRecordSlugs = new Map<string, string>(); // "<slug>.md" -> original record id
    for (const rec of m.records) {
      const fileSlug = slugify(rec.id);
      if (seenRecordSlugs.has(fileSlug)) {
        throw new Error(
          `Two records in memory module "${m.id}" map to the same file "${fileSlug}.md": "${seenRecordSlugs.get(fileSlug)}" and "${rec.id}". Rename one so they differ.`,
        );
      }
      seenRecordSlugs.set(fileSlug, rec.id);
      await writeFile(
        join(dir, `${fileSlug}.md`),
        stringifyFrontmatter({ id: rec.id, source: rec.source, data: rec.data }, ""),
      );
    }
    await reindexModule(dir, { name: m.name, kind: m.kind });
  }

  // Write the master index (module-level pointers, always loaded by the runtime context builder).
  const lines = agent.memoryModules
    .filter((m) => m.kind !== "working")
    .map(
      (m) =>
        `- **${m.name}** (${m.kind}) — ${m.description || "(no description)"} · ${m.records.length} records`,
    );
  await writeFile(join(root, "memory", "index.md"), `# Memory Index\n\n${lines.join("\n")}\n`);
}

async function readOptionalYaml(p: string): Promise<unknown | undefined> {
  try {
    return YAML.parse(await readFile(p, "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

async function loadModule(dir: string, kind: LtKind): Promise<MemoryModule> {
  const meta = YAML.parse(await readFile(join(dir, "_meta.yaml"), "utf8")) as Record<
    string,
    unknown
  >;
  const mod: Record<string, unknown> = { ...meta, kind, records: [] };
  const schema = await readOptionalYaml(join(dir, "_schema.yaml"));
  if (schema !== undefined) mod.schema = schema;
  const rubric = await readOptionalYaml(join(dir, "_rubric.yaml"));
  if (rubric !== undefined) mod.rubric = rubric;
  const procedural = await readOptionalYaml(join(dir, "_procedural.yaml"));
  if (procedural !== undefined) mod.procedural = procedural;
  const files = (await readdir(dir)).filter((f) => f.endsWith(".md") && !f.startsWith("_"));
  const records = [];
  for (const f of files) {
    const { data } = parseFrontmatter(await readFile(join(dir, f), "utf8"));
    records.push({
      id: String(data.id ?? f.replace(/\.md$/, "")),
      data: (data.data as Record<string, unknown>) ?? {},
      source: (data.source as string) ?? "seed",
    });
  }
  mod.records = records;
  try {
    return MemoryModule.parse(mod);
  } catch (err) {
    throw new Error(
      `Invalid memory module in "${dir}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function loadAgentFolder(root: string): Promise<{ agent: Agent; root: string }> {
  const { data, body } = parseFrontmatter(await readFile(join(root, "agent.md"), "utf8"));

  const memoryModules: MemoryModule[] = [
    ...((data.workingMemory as MemoryModule[]) ?? []),
  ];
  for (const kind of LONG_TERM_KINDS) {
    const kindDir = join(root, "memory", kind);
    let entries;
    try {
      entries = await readdir(kindDir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
    for (const entry of entries.filter((e) => e.isDirectory())) {
      try {
        memoryModules.push(await loadModule(join(kindDir, entry.name), kind));
      } catch (err) {
        throw new Error(
          `Could not load memory module "${entry.name}" in "${kindDir}". Check that _meta.yaml exists and is valid YAML. (Detail: ${err instanceof Error ? err.message : String(err)})`,
        );
      }
    }
  }

  const pathToId = new Map<string, string>(
    memoryModules.map((m) => [`${m.kind}/${slugify(m.id)}`, m.id] as const),
  );
  const accessPolicy = ((data.accessPolicy as Array<Record<string, unknown>>) ?? []).map((a) => ({
    memoryModuleId: pathToId.get(String(a.module)) ?? String(a.module),
    retrieval: a.retrieval,
    learning: a.learning,
  }));

  // Grounding interfaces are stored verbatim. A blueprint that was built without
  // strict validation (e.g. a `dialogue` interface given only its `type`) would
  // otherwise fail re-validation on load; backfill the required `id`/`name` from
  // the interface `type` so the round-trip yields a valid Agent.
  const grounding = ((data.grounding as Array<Record<string, unknown>>) ?? []).map((g, i) => {
    const type = g.type ? String(g.type) : "dialogue";
    return {
      id: g.id ?? `ground-${type}-${i}`,
      name: g.name ?? `${type[0]!.toUpperCase()}${type.slice(1)}`,
      ...g,
    };
  });

  const agent = parseAgent({
    id: data.id,
    name: data.name,
    naturalLanguageSpec: body.replace(/^#.*\n+/, "").trim(),
    goals: data.goals ?? [],
    providerConfig: data.provider,
    memoryModules,
    groundingInterfaces: grounding,
    accessPolicy,
    decisionProcedure: data.decisionProcedure,
    metadata: data.metadata,
  });
  return { agent, root };
}
