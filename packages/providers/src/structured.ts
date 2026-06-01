import type { ProviderName } from "@coala/core";
import type { z, ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  type CompletionRequest,
  type CompletionResponse,
  type LLMProvider,
  type StructuredOptions,
  ProviderError,
} from "./types.js";

/** Pull a JSON object/array out of an LLM response, tolerating ```json fences and prose. */
export function extractJson(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fence?.[1] ?? text).trim();

  // Narrow to the outermost JSON bracket pair if the model added prose around it.
  const firstObj = candidate.indexOf("{");
  const firstArr = candidate.indexOf("[");
  const start =
    firstArr === -1 || (firstObj !== -1 && firstObj < firstArr)
      ? firstObj
      : firstArr;
  if (start === -1) return candidate;

  const open = candidate[start]!;
  const close = open === "{" ? "}" : "]";
  const end = candidate.lastIndexOf(close);
  return end > start ? candidate.slice(start, end + 1) : candidate.slice(start);
}

const SYSTEM_SUFFIX = (jsonSchema: string) =>
  `\n\nYou MUST respond with a single JSON value that validates against this JSON Schema. ` +
  `Output ONLY the JSON — no prose, no code fences.\n\nJSON Schema:\n${jsonSchema}`;

/**
 * Provider-agnostic structured output: ask for JSON matching `schema`, parse,
 * validate with zod, and re-ask with the validation error on failure. This works
 * uniformly across every provider without depending on each one's native JSON mode.
 */
export async function completeStructuredVia<S extends ZodTypeAny>(
  provider: LLMProvider,
  providerName: ProviderName,
  req: CompletionRequest,
  schema: S,
  opts: StructuredOptions = {},
): Promise<z.infer<S>> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const jsonSchema = JSON.stringify(zodToJsonSchema(schema, "Output"), null, 2);
  const baseSystem = (req.system ?? "") + SYSTEM_SUFFIX(jsonSchema);

  const messages = [...req.messages];
  let lastError = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res: CompletionResponse = await provider.complete({
      ...req,
      system: baseSystem,
      messages,
    });

    const json = extractJson(res.text);
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (e) {
      lastError = `Response was not valid JSON: ${(e as Error).message}`;
      messages.push(
        { role: "assistant", content: res.text },
        { role: "user", content: `${lastError}\nReturn ONLY valid JSON matching the schema.` },
      );
      continue;
    }

    const result = schema.safeParse(parsed);
    if (result.success) return result.data as z.infer<S>;

    lastError = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    messages.push(
      { role: "assistant", content: res.text },
      {
        role: "user",
        content: `Your JSON failed validation: ${lastError}\nFix it and return ONLY corrected JSON.`,
      },
    );
  }

  throw new ProviderError(
    `Structured output failed after ${maxAttempts} attempts: ${lastError}`,
    providerName,
  );
}

/**
 * Base class implementing {@link LLMProvider.completeStructured} in terms of `complete`.
 * Concrete adapters only implement `complete` + `name`.
 */
export abstract class BaseProvider implements LLMProvider {
  abstract readonly name: ProviderName;
  abstract complete(req: CompletionRequest): Promise<CompletionResponse>;

  completeStructured<S extends ZodTypeAny>(
    req: CompletionRequest,
    schema: S,
    opts?: StructuredOptions,
  ): Promise<z.infer<S>> {
    return completeStructuredVia(this, this.name, req, schema, opts);
  }
}
