"use client";

import type { Agent } from "@coala/core";
import { RunPanel } from "../run-panel";
import { ScreenFrame } from "./screen-frame";

export function TestScreen({ agent, onBack }: { agent: Agent; onBack: () => void }) {
  return (
    <ScreenFrame breadcrumb="Overview · Try it" onBack={onBack}>
      <p className="text-sm text-slate-400">Send your agent a message and watch it run one decision cycle.</p>
      <RunPanel agent={agent} />
    </ScreenFrame>
  );
}
