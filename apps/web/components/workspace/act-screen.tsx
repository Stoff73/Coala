"use client";

import type { Agent } from "@coala/core";
import { GroundingSection, type Update } from "../board";
import { ScreenFrame } from "./screen-frame";

export function ActScreen({ agent, update, onBack }: { agent: Agent; update: Update; onBack: () => void }) {
  return (
    <ScreenFrame breadcrumb="Overview · Act" onBack={onBack}>
      <p className="text-sm text-slate-400">
        What your agent can do in the world — reply, run tools, change things. Tools that only read are shown under{" "}<em>Perceive</em>; tools marked destructive are flagged here.
      </p>
      <GroundingSection agent={agent} update={update} lens="act" />
    </ScreenFrame>
  );
}
