/**
 * Verbatim quotes from the CoALA paper (Sumers et al., TMLR 2024 — `2309.02427v3.pdf`),
 * keyed by board concept. Rendered by the <Why> popover so the UI teaches the framework inline.
 */
export interface GlossaryEntry {
  quote: string;
  cite: string;
}

export const COALA_GLOSSARY: Record<string, GlossaryEntry> = {
  // --- sections ---
  memory: {
    quote:
      "Under the CoALA framework, language agents explicitly organize information (mainly textual, but other modalities also allowed) into multiple memory modules, each containing a different form of information. These include short-term working memory and several long-term memories: episodic, semantic, and procedural.",
    cite: "§4.1",
  },
  access: {
    quote:
      "Agents' action spaces can be divided into internal memory accesses and external interactions with the world. Defining the agent's internal action space consists primarily of defining read and write access to each of the agent's memory modules.",
    cite: "§4.3–4.5, §6",
  },
  grounding: {
    quote:
      `Grounding procedures execute external actions and process environmental feedback into working memory as text. This effectively simplifies the agent's interaction with the outside world as a “text game” with textual observations and actions.`,
    cite: "§4.2",
  },
  decision: {
    quote:
      "CoALA structures this top-level program into decision cycles which yield an external grounding action or internal learning action. In each cycle, program code defines a sequence of reasoning or retrieval actions to propose and evaluate alternatives (planning stage), then executes the selected action (execution stage).",
    cite: "§4.6",
  },

  // --- memory kinds ---
  working: {
    quote:
      "Working memory maintains active and readily available information as symbolic variables for the current decision cycle. It thus serves as the central hub connecting different components of a language agent.",
    cite: "§4.1",
  },
  episodic: {
    quote:
      "Episodic memory stores experience from earlier decision cycles. During the planning stage of a decision cycle, these episodes may be retrieved into working memory to support reasoning. An agent can also write new experiences from working to episodic memory as a form of learning.",
    cite: "§4.1",
  },
  semantic: {
    quote:
      "Semantic memory stores an agent's knowledge about the world and itself.",
    cite: "§4.1",
  },
  procedural: {
    quote:
      "Language agents contain two forms of procedural memory: implicit knowledge stored in the LLM weights, and explicit knowledge written in the agent's code. Unlike episodic or semantic memory that may be initially empty or even absent, procedural memory must be initialized by the designer with proper code to bootstrap the agent.",
    cite: "§4.1",
  },

  // --- retrieval methods (the paper defines recency/importance/relevance jointly via Generative Agents) ---
  recency: {
    quote:
      "Generative Agents retrieves relevant events from episodic memory via a combination of recency (rule-based), importance (reasoning-based), and relevance (embedding-based) scores.",
    cite: "§4.3",
  },
  importance: {
    quote:
      "Generative Agents retrieves relevant events from episodic memory via a combination of recency (rule-based), importance (reasoning-based), and relevance (embedding-based) scores.",
    cite: "§4.3",
  },
  relevance: {
    quote:
      "Generative Agents retrieves relevant events from episodic memory via a combination of recency (rule-based), importance (reasoning-based), and relevance (embedding-based) scores.",
    cite: "§4.3",
  },
  embedding: {
    quote:
      "Voyager loads code-based skills from a skill library via dense retrieval to interact with the Minecraft world.",
    cite: "§4.3",
  },
  rule: {
    quote:
      "In CoALA, a retrieval procedure reads information from long-term memories into working memory. Depending on the information and memory type, it could be implemented in various ways, e.g., rule-based, sparse, or dense retrieval.",
    cite: "§4.3",
  },

  // --- learning operations ---
  "learning-add": {
    quote:
      "Learning occurs by writing information to long-term memory, which includes a spectrum of diverse procedures. Added experiences in episodic memory may be retrieved later as examples and bases for reasoning or decision-making.",
    cite: "§4.5",
  },
  "learning-modify": {
    quote:
      `While our discussion has mostly focused on adding to memory, modifying and deleting (a case of "unlearning") are understudied in recent language agents.`,
    cite: "§4.5",
  },
  "learning-delete": {
    quote:
      `New forms of learning (and unlearning) could include … deleting unneeded memory items for "unlearning", and studying the interaction effects between multiple forms of learning.`,
    cite: "§4.5, §6",
  },

  // --- grounding types ---
  dialogue: {
    quote:
      "Classic linguistic interactions allow the agent to accept instructions or learn from people. Agents capable of generating language may ask for help or clarification — or entertain or emotionally help people.",
    cite: "§4.2",
  },
  physical: {
    quote:
      "Physical embodiment is the oldest instantiation envisioned for AI agents. It involves processing perceptual inputs (visual, audio, tactile) into textual observations, and affecting the physical environments via robotic planners that take language-based commands.",
    cite: "§4.2",
  },
  digital: {
    quote:
      "This includes interacting with games, APIs, and websites as well as general code execution. Such digital grounding is cheaper and faster than physical or human interaction. It is thus a convenient testbed for language agents.",
    cite: "§4.2",
  },

  // --- decision sub-stages ---
  proposal: {
    quote:
      "The proposal sub-stage generates one or more action candidates. The usual approach is to use reasoning (and optionally retrieval) to sample one or more external grounding actions from the LLM.",
    cite: "§4.6",
  },
  evaluation: {
    quote:
      "If multiple actions are proposed, the evaluation sub-stage assigns a value to each. This may use heuristic rules, LLM (perplexity) values, learned values, LLM reasoning, or some combination.",
    cite: "§4.6",
  },
  selection: {
    quote:
      "Given a set of actions and their values, the selection step either selects one to execute or rejects them and loops back to the proposal step. Depending on the form of action values, selection may occur via argmax, softmax, or an alternative such as majority vote.",
    cite: "§4.6",
  },
};
