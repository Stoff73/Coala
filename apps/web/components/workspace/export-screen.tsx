"use client";

import type { Agent } from "@coala/core";
import { ExportBar } from "../board";
import { ScreenFrame } from "./screen-frame";

export function ExportScreen({ agent, onBack }: { agent: Agent; onBack: () => void }) {
  return (
    <ScreenFrame breadcrumb="Overview · Export" onBack={onBack}>
      <p className="text-sm text-slate-400">Download your agent as a runnable project, or as the neutral blueprint.</p>
      <ExportBar agent={agent} />
    </ScreenFrame>
  );
}
