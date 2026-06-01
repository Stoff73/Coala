import type { ProviderName } from "@coala/core";
import { BaseProvider } from "./structured.js";
import { type CompletionRequest, type CompletionResponse, ProviderError } from "./types.js";

export interface MockRoute {
  /** Return true if this route should answer the request. */
  match: (req: CompletionRequest) => boolean;
  /** Canned response text (typically the JSON the structured wrapper will parse). */
  text: string | ((req: CompletionRequest) => string);
}

/**
 * Deterministic provider for tests and offline development. Routes are tried in
 * order; the first match answers. Records every call for assertions.
 */
export class MockProvider extends BaseProvider {
  readonly calls: CompletionRequest[] = [];

  constructor(
    private readonly routes: MockRoute[],
    readonly name: ProviderName = "local",
  ) {
    super();
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    this.calls.push(req);
    const route = this.routes.find((r) => r.match(req));
    if (!route) {
      throw new ProviderError("MockProvider: no route matched request", this.name);
    }
    const text = typeof route.text === "function" ? route.text(req) : route.text;
    return { text };
  }
}

/** Convenience: match when any message content includes a marker string. */
export const whenIncludes =
  (marker: string) =>
  (req: CompletionRequest): boolean =>
    (req.system ?? "").includes(marker) ||
    req.messages.some((m) => m.content.includes(marker));
