import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertInside } from "./paths.js";

export interface SkillDef {
  id: string;
  kind: "template" | "reference" | "script";
  content?: string;                                   // template
  path?: string;                                      // reference
  run?: { interpreter: string; script: string };      // script
}

export interface ResolvedSkill {
  id: string;
  kind: SkillDef["kind"];
  executed: false;            // execution is deferred this round
  content?: string;
  placeholder?: string;
}

/** Resolve a skill's pointer. Scripts are surfaced, never executed (this round). */
export async function resolveSkill(root: string, skill: SkillDef): Promise<ResolvedSkill> {
  switch (skill.kind) {
    case "template":
      return { id: skill.id, kind: "template", executed: false, content: skill.content ?? "" };
    case "reference": {
      if (!skill.path) throw new Error(`Skill "${skill.id}" (reference) is missing required field "path".`);
      assertInside(root, skill.path);
      const content = await readFile(resolve(root, skill.path), "utf8");
      return { id: skill.id, kind: "reference", executed: false, content };
    }
    case "script": {
      const script = skill.run?.script;
      if (!script) throw new Error(`Skill "${skill.id}" (script) is missing required field "run.script".`);
      assertInside(root, script);
      return {
        id: skill.id,
        kind: "script",
        executed: false,
        placeholder: `would run ${skill.run?.interpreter ?? "?"} ${script}`,
      };
    }
  }
}
