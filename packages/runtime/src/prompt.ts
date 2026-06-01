import type { Agent } from "@coala/core";
import type { CompletionRequest } from "@coala/providers";
import type { WorkingMemory } from "./memory.js";

export interface ActionTarget {
  tools: { name: string; description: string }[];
  writableModules: { id: string; name: string; kind: string }[];
  hasDialogue: boolean;
}

/** What the agent can do this cycle, derived from its action space. */
export function actionTargets(agent: Agent): ActionTarget {
  const tools = agent.groundingInterfaces
    .filter((g) => g.type === "digital")
    .flatMap((g) => g.digitalTools.map((t) => ({ name: t.name, description: t.description })));
  const writableModules = agent.accessPolicy
    .filter((a) => a.learning.add)
    .map((a) => agent.memoryModules.find((m) => m.id === a.memoryModuleId))
    .filter((m): m is NonNullable<typeof m> => !!m)
    .map((m) => ({ id: m.id, name: m.name, kind: m.kind }));
  const hasDialogue = agent.groundingInterfaces.some((g) => g.type === "dialogue");
  return { tools, writableModules, hasDialogue };
}

export function reasonRequest(
  agent: Agent,
  working: WorkingMemory,
  targets: ActionTarget,
): CompletionRequest {
  const toolLines = targets.tools.length
    ? targets.tools.map((t) => `  - ${t.name}: ${t.description}`).join("\n")
    : "  (none)";
  const writeLines = targets.writableModules.length
    ? targets.writableModules.map((m) => `  - id="${m.id}" (${m.kind}) ${m.name}`).join("\n")
    : "  (none)";

  const system = [
    `You are the decision procedure of a CoALA language agent named "${agent.name}".`,
    `Goals: ${agent.goals.join("; ") || "(none specified)"}.`,
    "Each cycle: reason over working memory, then choose ONE next action.",
    "",
    "Action types:",
    '  - "grounding": call a digital tool. Provide "tool" and "args".',
    '  - "learning": write a record to long-term memory. Provide "memoryModuleId" and "record".',
    '  - "respond": reply to the user (ends the turn). Provide "message".',
    '  - "finish": end the turn with no further output. Optionally provide "result".',
    "",
    "Available tools:",
    toolLines,
    "Writable memory modules (learning targets):",
    writeLines,
    targets.hasDialogue
      ? 'This agent can talk to the user — use "respond" to answer.'
      : 'This agent has no dialogue interface — use "finish" to end.',
    "Prefer to act/retrieve before responding. Do not invent tools or module ids.",
  ].join("\n");

  const user = `Working memory:\n${JSON.stringify(working.snapshot(), null, 2)}\n\nChoose the next action.`;

  return {
    model: agent.providerConfig.model,
    system,
    messages: [{ role: "user", content: user }],
    temperature: agent.providerConfig.temperature,
  };
}
