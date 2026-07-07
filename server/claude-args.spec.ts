import { describe, it, expect } from "vitest";
import { buildClaudeArgs, type ClaudeArgsInput } from "./claude-args.js";

const base: ClaudeArgsInput = {
  sessionId: "11111111-1111-1111-1111-111111111111",
  resume: null,
  canResume: false,
  settings: "{hooks}",
  permissionMode: "auto",
};

describe("buildClaudeArgs", () => {
  it("starts a fresh session with hooks and permission mode", () => {
    const args = buildClaudeArgs(base);
    expect(args).toEqual(["--session-id", base.sessionId, "--settings", "{hooks}", "--permission-mode", "auto"]);
  });

  it("resumes with --resume when canResume", () => {
    const resume = "22222222-2222-2222-2222-222222222222";
    const args = buildClaudeArgs({ ...base, resume, canResume: true });
    expect(args.slice(0, 4)).toEqual(["--resume", resume, "--settings", "{hooks}"]);
    expect(args).not.toContain("--session-id");
  });

  it("falls back to --session-id when canResume is false even if a resume id is present", () => {
    const args = buildClaudeArgs({ ...base, resume: "33333333-3333-3333-3333-333333333333", canResume: false });
    expect(args).toContain("--session-id");
    expect(args).not.toContain("--resume");
  });

  it("appends the initial prompt as a positional after -- (option terminator)", () => {
    const args = buildClaudeArgs({ ...base, initialPrompt: "-rf danger" });
    expect(args.slice(-2)).toEqual(["--", "-rf danger"]);
  });
});
