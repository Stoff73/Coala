"use client";

import type { Agent } from "@coala/core";
import { GroundingSection, type Update } from "../board";
import { ScreenFrame } from "./screen-frame";

export function PerceiveScreen({ agent, update, onBack }: { agent: Agent; update: Update; onBack: () => void }) {
  return (
    <ScreenFrame breadcrumb="Overview · Perceive" onBack={onBack}>
      <p className="text-sm text-slate-400">
        How the world reaches your agent — the messages it receives and the things it can look up. Dialogue and
        physical channels work both ways, so they also appear under <em>Act</em>.
      </p>
      <GroundingSection agent={agent} update={update} lens="perceive" />
    </ScreenFrame>
  );
}
