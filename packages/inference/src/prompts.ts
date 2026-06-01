import type { MemoryPassOutput } from "./schemas.js";

export interface InferenceInput {
  name: string;
  naturalLanguageSpec: string;
}

export interface Prompt {
  system: string;
  user: string;
}

/** Compact list of inferred modules, fed into passes B and C for grounding. */
function moduleSummary(mem: MemoryPassOutput): string {
  if (mem.modules.length === 0) return "(none proposed yet)";
  return mem.modules.map((m) => `- ${m.name} [${m.kind}]: ${m.description}`).join("\n");
}

/** Pass A — memory modules. The tag line makes passes routable for tests/telemetry. */
export function memoryPrompt(input: InferenceInput): Prompt {
  return {
    system: [
      "[CoALA inference: memory pass]",
      "You are a CoALA architect. Decide which memory modules a language agent needs.",
      "CoALA memory kinds:",
      "- working: short-term hub carried across the decision cycle (ALWAYS present).",
      "- procedural: the LLM + agent code/prompt templates (ALWAYS present).",
      "- episodic: past experiences / trajectories / interaction history.",
      "- semantic: facts about the world or the agent itself (e.g. a catalog, a knowledge base).",
      "For every episodic and semantic module, define a recordSchema (the shape of one stored item).",
      "Give each module a one-sentence rationale. Only add episodic/semantic modules the agent truly needs.",
    ].join("\n"),
    user: `Agent name: ${input.name}\nDescription: ${input.naturalLanguageSpec}\n\nReturn the agent's goals and its memory modules.`,
  };
}

/** Pass B — internal action space (read/write access per module). */
export function accessPrompt(input: InferenceInput, mem: MemoryPassOutput): Prompt {
  return {
    system: [
      "[CoALA inference: access pass]",
      "Define the agent's internal action space: for each LONG-TERM memory module",
      "(episodic / semantic / procedural) decide read access (retrieval) and write access",
      "(learning: add / modify / delete). Working memory needs no grant.",
      "Guidance (CoALA §6): grant write access only where the agent should durably learn;",
      "keep reference data (e.g. an inventory/catalog) read-only; writing to procedural memory",
      "(the agent's own code) is powerful but risky — avoid unless clearly intended.",
      "If you grant read access, choose a retrieval method: recency, importance, relevance, embedding, or rule.",
    ].join("\n"),
    user: `Agent: ${input.name}\nDescription: ${input.naturalLanguageSpec}\n\nMemory modules:\n${moduleSummary(
      mem,
    )}\n\nReturn an access grant for each long-term module (reference modules by their exact name).`,
  };
}

/** Pass C — decision procedure + external action space (grounding). */
export function decisionPrompt(input: InferenceInput, mem: MemoryPassOutput): Prompt {
  return {
    system: [
      "[CoALA inference: decision pass]",
      "Define the decision procedure and the external action space (grounding).",
      "Decision styles: react, tot, reflexion, generative-agents, saycan, custom.",
      "Planning sub-stages — enable what the task needs:",
      "- proposal: generate candidate actions (almost always on).",
      "- evaluation: score candidates (add for tasks needing judgement/search).",
      "- selection: choose/backtrack among candidates (add for deliberate search like tree-of-thoughts).",
      "Grounding types: dialogue (talk to humans/agents), physical (robot/world), digital (APIs/tools).",
      "For digital grounding, list the tools the agent may call. An agent needs at least one grounding interface.",
    ].join("\n"),
    user: `Agent: ${input.name}\nDescription: ${input.naturalLanguageSpec}\n\nMemory modules:\n${moduleSummary(
      mem,
    )}\n\nReturn the decision procedure and grounding interfaces.`,
  };
}
