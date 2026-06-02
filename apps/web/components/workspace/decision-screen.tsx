"use client";

import type { Agent } from "@coala/core";
import { DecisionSection, type Update } from "../board";
import { ScreenFrame } from "./screen-frame";

export function DecisionScreen({ agent, update, onBack }: { agent: Agent; update: Update; onBack: () => void }) {
  return (
    <ScreenFrame breadcrumb="Overview · Decision" onBack={onBack}>
      <p className="text-sm text-slate-400">
        How your agent chooses what to do each turn: it can <strong>propose</strong> options, <strong>evaluate</strong>{" "}
        them, and <strong>select</strong> one. Simpler agents just propose; more deliberate ones do all three.
      </p>
      <DecisionSection agent={agent} update={update} />
    </ScreenFrame>
  );
}
