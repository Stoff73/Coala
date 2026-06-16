import { describe, it, expect } from "vitest";
import { AGENT_FS_VERSION } from "../index.js";

describe("@coala/agent-fs", () => {
  it("exposes a version constant", () => {
    expect(AGENT_FS_VERSION).toBe(1);
  });
});
