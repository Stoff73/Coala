import type { ProposedAction } from "./schema.js";
import type { Record_ } from "./memory.js";

export interface RetrievedItem {
  moduleId: string;
  moduleName: string;
  method: string;
  records: Record_[];
}

export interface MemoryWrite {
  moduleId: string;
  moduleName: string;
  record: Record_;
}

/** One decision cycle (paper §4.6): retrieve → reason/propose → execute. */
export interface CycleStep {
  step: number;
  retrieved: RetrievedItem[];
  thought: string;
  action: ProposedAction;
  observation?: unknown;
  memoryWrite?: MemoryWrite;
  /** Set when the action could not be carried out (e.g. write to a non-writable module). */
  blocked?: string;
  terminal: boolean;
}

export interface TurnResult {
  reply: string | null;
  steps: CycleStep[];
}
