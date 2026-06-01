/**
 * @coala/inference — turns a plain-English agent description into a CoALA blueprint
 * using the paper's §6 three-step recipe (Memory → Access → Decision).
 */
export { inferBlueprint, type InferenceInput, type InferenceResult } from "./infer.js";
export { assembleAgent, type AssembleInput } from "./assemble.js";
export {
  memoryPrompt,
  accessPrompt,
  decisionPrompt,
  type Prompt,
} from "./prompts.js";
export {
  MemoryPassOutput,
  AccessPassOutput,
  DecisionPassOutput,
} from "./schemas.js";
