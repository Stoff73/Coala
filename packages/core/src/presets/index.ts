import type { Agent } from "../schema/agent.js";
import { reactAgent } from "./react.js";
import { voyagerAgent } from "./voyager.js";
import { generativeAgentsAgent } from "./generative-agents.js";
import { treeOfThoughtsAgent } from "./tree-of-thoughts.js";
import { sayCanAgent } from "./saycan.js";
import { retailAssistantAgent } from "./retail-assistant.js";

export {
  reactAgent,
  voyagerAgent,
  generativeAgentsAgent,
  treeOfThoughtsAgent,
  sayCanAgent,
  retailAssistantAgent,
};

/** All Table 2 / §6 archetypes, used as starter templates and as linter fixtures. */
export const PRESETS: readonly Agent[] = [
  reactAgent,
  voyagerAgent,
  generativeAgentsAgent,
  treeOfThoughtsAgent,
  sayCanAgent,
  retailAssistantAgent,
];

/** Look up a preset by its metadata.preset key. */
export function getPreset(key: string): Agent | undefined {
  return PRESETS.find((a) => a.metadata.preset === key);
}
