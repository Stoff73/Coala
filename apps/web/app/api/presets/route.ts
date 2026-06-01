import { NextResponse } from "next/server";
import { PRESETS, lintAgent } from "@coala/core";

export const runtime = "nodejs";

/**
 * The six Table 2 archetypes, each with its linter findings attached so the board
 * renders identically to an inferred blueprint — and the app is demoable with no API key.
 */
export async function GET() {
  const presets = PRESETS.map((agent) => {
    const lint = lintAgent(agent);
    return { agent, findings: lint.findings, ok: lint.ok };
  });
  return NextResponse.json({ presets });
}
