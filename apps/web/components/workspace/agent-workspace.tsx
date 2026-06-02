"use client";

import { useEffect, useMemo, useState } from "react";
import type { Agent } from "@coala/core";
import type { BlueprintResult } from "../../lib/types";
import { summarizeHealth } from "../../lib/health";
import { BlueprintBoard, type Update } from "../board";
import { SystemMap } from "./system-map";
import { ScreenFrame } from "./screen-frame";

export type Screen = "map" | "memory" | "perceive" | "act" | "decision" | "test" | "export" | "board";

export function AgentWorkspace({ result, onChange }: { result: BlueprintResult; onChange?: (agent: Agent) => void }) {
  const [agent, setAgent] = useState<Agent>(result.agent);
  const [screen, setScreen] = useState<Screen>("map");
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [focusModuleId, setFocusModuleId] = useState<string | undefined>(undefined);

  useEffect(() => {
    onChange?.(agent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent]);

  const update: Update = (fn) =>
    setAgent((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });

  const health = useMemo(() => summarizeHealth(agent), [agent]);
  const navigate = (s: Screen, moduleId?: string) => {
    setFocusModuleId(moduleId);
    setScreen(s);
  };
  const back = () => setScreen("map");

  if (screen === "board") {
    return (
      <ScreenFrame breadcrumb="Overview · Expert view" onBack={back}>
        <BlueprintBoard result={result} agent={agent} update={update} />
      </ScreenFrame>
    );
  }
  if (screen !== "map") {
    // TEMPORARY stub — replaced by real screens in later tasks.
    return (
      <ScreenFrame breadcrumb={`Overview · ${screen}`} onBack={back}>
        <p className="text-sm text-slate-400">"{screen}" screen coming next.</p>
      </ScreenFrame>
    );
  }
  return <SystemMap agent={agent} update={update} health={health} navigate={navigate} />;
}
