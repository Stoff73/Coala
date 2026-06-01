import type { ProviderConfig } from "../schema/agent.js";

/** Default model binding for presets; users rebind per agent in the UI. */
export const defaultProvider: ProviderConfig = {
  provider: "anthropic",
  model: "claude-opus-4-8",
};
