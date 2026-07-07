import { describe, expect, it } from "vitest";
import { createClaudeAgentKind, detectAgentProcess } from "./agent-kind.js";

describe("Claude AgentKind", () => {
  const agent = createClaudeAgentKind("claude");

  it("matches Claude commands without matching unrelated commands that mention claude", () => {
    expect(agent.matchesCommand("claude")).toBe(true);
    expect(agent.matchesProcessArgs("claude --model opus")).toBe(true);
    expect(agent.matchesProcessArgs("node /usr/local/bin/claude.js")).toBe(true);
    expect(agent.matchesProcessArgs("grep claude")).toBe(false);
  });

  it("builds resume commands through the Claude args builder", () => {
    expect(
      agent.resumeCommand({
        sessionId: "new",
        resume: "old",
        canResume: true,
        settings: "{hooks}",
        permissionMode: "auto",
      }),
    ).toEqual(["--resume", "old", "--settings", "{hooks}", "--permission-mode", "auto"]);
  });

  it("extracts ai-title from a transcript", () => {
    expect(agent.titleFromTranscript('{"type":"ai-title","aiTitle":"Plan work"}\n')).toBe("Plan work");
  });

  it("detects the first matching agent from command or process rows", () => {
    expect(detectAgentProcess([agent], "zsh", ["grep claude", "node /opt/bin/claude.mjs"])?.kind).toBe("claude");
    expect(detectAgentProcess([agent], "zsh", ["grep claude"])).toBeNull();
  });
});
