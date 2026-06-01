import { type Agent, type Finding, type ProviderConfig, lintAgent } from "@coala/core";
import type { CompletionRequest, LLMProvider } from "@coala/providers";
import { assembleAgent } from "./assemble.js";
import { accessPrompt, decisionPrompt, memoryPrompt, type Prompt } from "./prompts.js";
import {
  AccessPassOutput,
  DecisionPassOutput,
  MemoryPassOutput,
} from "./schemas.js";

export interface InferenceInput {
  name: string;
  naturalLanguageSpec: string;
  providerConfig: ProviderConfig;
  agentId?: string;
}

export interface InferenceResult {
  agent: Agent;
  /** CoALA linter output for the assembled blueprint (PLAN §7). */
  findings: Finding[];
  ok: boolean;
  /** Raw structured output of each pass, for the self-explaining UI / debugging. */
  transcript: {
    memory: MemoryPassOutput;
    access: AccessPassOutput;
    decision: DecisionPassOutput;
  };
}

function toRequest(prompt: Prompt, config: ProviderConfig): CompletionRequest {
  return {
    model: config.model,
    system: prompt.system,
    messages: [{ role: "user", content: prompt.user }],
    temperature: config.temperature,
  };
}

/**
 * The §6 three-pass inference engine: natural-language spec → CoALA blueprint.
 * Memory → Access → Decision, each a validated structured-output call, then
 * assembled and linted. This is the "describe → we work out your memory modules" core.
 */
export async function inferBlueprint(
  input: InferenceInput,
  provider: LLMProvider,
): Promise<InferenceResult> {
  const config = input.providerConfig;

  // Pass A — memory modules.
  const memory = await provider.completeStructured(
    toRequest(memoryPrompt(input), config),
    MemoryPassOutput,
  );

  // Pass B — internal action space (depends on the proposed modules).
  const access = await provider.completeStructured(
    toRequest(accessPrompt(input, memory), config),
    AccessPassOutput,
  );

  // Pass C — decision procedure + grounding.
  const decision = await provider.completeStructured(
    toRequest(decisionPrompt(input, memory), config),
    DecisionPassOutput,
  );

  const agent = assembleAgent(input, memory, access, decision);
  const lint = lintAgent(agent);

  return {
    agent,
    findings: lint.findings,
    ok: lint.ok,
    transcript: { memory, access, decision },
  };
}
