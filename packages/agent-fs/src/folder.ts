import { mkdir, writeFile, readFile, readdir, access } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { parseAgent, type Agent, type MemoryModule } from "@coala/core";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.js";
import { reindexModule } from "./reindex.js";
import { slugify } from "./paths.js";

const MODULE_KINDS = ["semantic", "episodic", "procedural"] as const;
type LtKind = (typeof MODULE_KINDS)[number];

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

  for (const m of agent.memoryModules) {
    if (!MODULE_KINDS.includes(m.kind as LtKind)) continue; // working memory has no folder
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
    for (const rec of m.records) {
      await writeFile(
        join(dir, `${slugify(rec.id)}.md`),
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

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function loadModule(dir: string, kind: LtKind): Promise<MemoryModule> {
  const meta = YAML.parse(await readFile(join(dir, "_meta.yaml"), "utf8")) as Record<
    string,
    unknown
  >;
  const mod: Record<string, unknown> = { ...meta, kind, records: [] };
  if (await exists(join(dir, "_schema.yaml")))
    mod.schema = YAML.parse(await readFile(join(dir, "_schema.yaml"), "utf8"));
  if (await exists(join(dir, "_rubric.yaml")))
    mod.rubric = YAML.parse(await readFile(join(dir, "_rubric.yaml"), "utf8"));
  if (await exists(join(dir, "_procedural.yaml")))
    mod.procedural = YAML.parse(await readFile(join(dir, "_procedural.yaml"), "utf8"));
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
  return mod as unknown as MemoryModule;
}

export async function loadAgentFolder(root: string): Promise<{ agent: Agent; root: string }> {
  const { data, body } = parseFrontmatter(await readFile(join(root, "agent.md"), "utf8"));

  const memoryModules: MemoryModule[] = [
    ...((data.workingMemory as MemoryModule[]) ?? []),
  ];
  for (const kind of MODULE_KINDS) {
    const kindDir = join(root, "memory", kind);
    if (!(await exists(kindDir))) continue;
    for (const slug of await readdir(kindDir)) {
      memoryModules.push(await loadModule(join(kindDir, slug), kind));
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

  const agent = parseAgent({
    id: data.id,
    name: data.name,
    naturalLanguageSpec: body.replace(/^#.*\n+/, "").trim(),
    goals: data.goals ?? [],
    providerConfig: data.provider,
    memoryModules,
    groundingInterfaces: data.grounding ?? [],
    accessPolicy,
    decisionProcedure: data.decisionProcedure,
    metadata: data.metadata,
  });
  return { agent, root };
}
