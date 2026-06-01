import { parseAgent, type ProviderName } from "@coala/core";
import { createEmbeddingProvider, createProvider, credentialsFromEnv } from "@coala/providers";
import { AgentRuntime, buildTools } from "@coala/runtime";
import { fail, ok } from "../../../lib/api";

// Executes the decision cycle against a live LLM — server-side, reads keys from env.
export const runtime = "nodejs";

const KEYLESS: ProviderName[] = ["ollama", "local"];

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));

  let agent;
  try {
    agent = parseAgent(body.agent);
  } catch (e) {
    return fail(`Invalid blueprint: ${e instanceof Error ? e.message : "parse error"}`);
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return fail("A message is required.");

  const provider = agent.providerConfig.provider;
  const credentials = credentialsFromEnv(provider);
  if (!credentials.apiKey && !KEYLESS.includes(provider)) {
    return fail(`No API key configured for "${provider}". Add it to .env to run the agent.`, 400);
  }

  // Connect any MCP servers the agent declares. stdio spawns a subprocess, so it is
  // gated behind COALA_ALLOW_MCP_STDIO; http (streamable) MCP is always allowed.
  // Grounding tools with no MCP backing return stub observations (implement them in your export).
  const allowStdio = process.env.COALA_ALLOW_MCP_STDIO === "1";
  let built;
  try {
    built = await buildTools(agent, { allowStdio });
  } catch (e) {
    return fail(`MCP setup failed: ${e instanceof Error ? e.message : "connection error"}`, 400);
  }

  // Real embedding retrieval: OpenAI vectors when a key is present, else the
  // deterministic local embedder (still genuine cosine, just lexical, no key needed).
  const embedder = process.env.OPENAI_API_KEY
    ? createEmbeddingProvider({ provider: "openai", creds: credentialsFromEnv("openai") })
    : createEmbeddingProvider({ provider: "local" });

  try {
    const llm = createProvider(agent.providerConfig, credentials);
    const rt = new AgentRuntime(agent, llm, built.registry, { maxSteps: 6, embedder });
    const result = await rt.runTurn(message);
    return ok(result);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Run failed.", 500);
  } finally {
    await built.close();
  }
}
