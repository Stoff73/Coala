import type { WorkingMemory, Record_ } from "./memory.js";

export interface ToolContext {
  working: WorkingMemory;
}

export type ToolHandler = (
  args: Record_,
  ctx: ToolContext,
) => Promise<unknown> | unknown;

/**
 * Registry of grounding-tool implementations supplied by the host. Unregistered
 * tools return a marked stub observation so the cycle can continue and the trace
 * shows the gap (rather than throwing).
 */
export class ToolRegistry {
  private handlers = new Map<string, ToolHandler>();

  register(name: string, handler: ToolHandler): this {
    this.handlers.set(name, handler);
    return this;
  }

  has(name: string): boolean {
    return this.handlers.has(name);
  }

  async run(name: string, args: Record_, ctx: ToolContext): Promise<unknown> {
    const handler = this.handlers.get(name);
    if (!handler) return { unhandled: true, tool: name, args };
    return await handler(args, ctx);
  }
}
