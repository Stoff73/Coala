import type { Agent } from "@coala/core";
import { type CodegenAdapter, type GeneratedFile, slug } from "./types.js";

/**
 * LangGraph (Python) scaffold. CoALA maps cleanly onto LangGraph:
 *   graph nodes/edges = the decision cycle, graph state = working memory,
 *   store/checkpointer = long-term memory (PLAN §6a).
 */
export const langgraphAdapter: CodegenAdapter = {
  id: "langgraph",
  label: "LangGraph (Python)",
  generate(agent: Agent): GeneratedFile[] {
    const p = agent.decisionProcedure.planning;
    const enabled = (
      [
        ["propose", p.proposal],
        ["evaluate", p.evaluation],
        ["select", p.selection],
      ] as const
    ).filter(([, s]) => s.enabled);
    // Always end with an execute node.
    const nodes = [...enabled.map(([k]) => k), "execute"];

    const ltmComments = agent.memoryModules
      .filter((m) => m.kind !== "working")
      .map((m) => {
        const g = agent.accessPolicy.find((x) => x.memoryModuleId === m.id);
        const access = g
          ? `read=${g.retrieval.enabled ? (g.retrieval.method ?? "yes") : "no"}, ` +
            `write=${g.learning.add || g.learning.modify || g.learning.delete}`
          : "no access";
        return `#   - ${m.name} [${m.kind}] (${access})`;
      })
      .join("\n");

    const toolComments = agent.groundingInterfaces
      .map((g) => {
        const tools =
          g.type === "digital" && g.digitalTools.length
            ? `: ${g.digitalTools.map((t) => t.name).join(", ")}`
            : "";
        return `#   - ${g.name} [${g.type}]${tools}`;
      })
      .join("\n");

    const nodeDefs = nodes
      .map((n) => {
        const stage = enabled.find(([k]) => k === n);
        const strategy = stage?.[1].strategy;
        return `def ${n}(state: WorkingMemory) -> WorkingMemory:\n    ${strategy ? `# ${strategy}` : "# TODO"}\n    return state\n`;
      })
      .join("\n");

    const edges = nodes
      .map((n, i) =>
        i < nodes.length - 1
          ? `graph.add_edge("${n}", "${nodes[i + 1]}")`
          : `graph.add_edge("${n}", END)`,
      )
      .join("\n");

    const content = `# Generated from a CoALA Blueprint — "${agent.name}".
# Decision style: ${agent.decisionProcedure.style}
# pip install langgraph
from typing import TypedDict, Any
from langgraph.graph import StateGraph, END


# Working memory = graph state (the CoALA short-term hub).
class WorkingMemory(TypedDict, total=False):
    inputs: Any
    plan: Any
    selected_action: Any


# Long-term memory (wire to a vector store / checkpointer):
${ltmComments || "#   (none)"}

# Grounding (external action space):
${toolComments || "#   (none)"}


${nodeDefs}
graph = StateGraph(WorkingMemory)
${nodes.map((n) => `graph.add_node("${n}", ${n})`).join("\n")}
graph.set_entry_point("${nodes[0]}")
${edges}

app = graph.compile()
`;

    return [{ path: `${slug(agent.name)}_graph.py`, content, language: "python" }];
  },
};
