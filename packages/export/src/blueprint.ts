import { Agent, parseAgent } from "@coala/core";
import { zodToJsonSchema } from "zod-to-json-schema";
import YAML from "yaml";

/**
 * The canonical, framework-neutral CoALA Blueprint serializers (PLAN §6a).
 * The Agent document IS the blueprint; these just render/validate it portably.
 */

export function toBlueprintJSON(agent: Agent): string {
  return JSON.stringify(agent, null, 2);
}

export function toBlueprintYAML(agent: Agent): string {
  return YAML.stringify(agent);
}

/** Published JSON Schema for the blueprint format — the interop contract. */
export function blueprintJsonSchema(): Record<string, unknown> {
  return zodToJsonSchema(Agent, "CoALABlueprint") as Record<string, unknown>;
}

/** Parse + validate a JSON or YAML blueprint back into a typed Agent. */
export function parseBlueprint(input: string, format: "json" | "yaml" = "json"): Agent {
  const data = format === "yaml" ? YAML.parse(input) : JSON.parse(input);
  return parseAgent(data);
}
