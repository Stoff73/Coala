import { NextResponse } from "next/server";
import type { ProviderName } from "@coala/core";
import { inferBlueprint } from "@coala/inference";
import { createProvider, credentialsFromEnv } from "@coala/providers";

// Inference talks to an LLM and reads secrets from env — must run server-side in Node.
export const runtime = "nodejs";

const KEYLESS: ProviderName[] = ["ollama", "local"];

interface InferBody {
  name?: string;
  naturalLanguageSpec?: string;
  provider?: ProviderName;
  model?: string;
  temperature?: number;
}

export async function POST(request: Request) {
  let body: InferBody;
  try {
    body = (await request.json()) as InferBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const name = body.name?.trim();
  const naturalLanguageSpec = body.naturalLanguageSpec?.trim();
  const provider = body.provider ?? "anthropic";
  const model = body.model?.trim();

  if (!name || !naturalLanguageSpec) {
    return NextResponse.json(
      { error: "Both a name and a description are required." },
      { status: 400 },
    );
  }
  if (!model) {
    return NextResponse.json({ error: "A model id is required." }, { status: 400 });
  }

  const credentials = credentialsFromEnv(provider);
  if (!credentials.apiKey && !KEYLESS.includes(provider)) {
    return NextResponse.json(
      {
        error: `No API key configured for "${provider}". Add it to .env (see .env.example) and restart the server.`,
      },
      { status: 400 },
    );
  }

  try {
    const llm = createProvider({ provider, model, temperature: body.temperature }, credentials);
    const result = await inferBlueprint(
      { name, naturalLanguageSpec, providerConfig: { provider, model, temperature: body.temperature } },
      llm,
    );
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Inference failed." },
      { status: 500 },
    );
  }
}
