// Pure builder for the `claude` CLI argv. Kept separate so the exact flag set is
// unit-testable without spawning a PTY.

export interface ClaudeArgsInput {
  sessionId: string;
  resume: string | null;
  // Whether the requested session has an on-disk transcript to --resume. When
  // false we start fresh, reusing the id via --session-id.
  canResume: boolean;
  settings: string; // hook settings JSON (--settings)
  permissionMode: string; // --permission-mode
  initialPrompt?: string;
}

export function buildClaudeArgs(input: ClaudeArgsInput): string[] {
  const permissionArgs = ["--permission-mode", input.permissionMode];

  const baseArgs =
    input.canResume && input.resume !== null
      ? ["--resume", input.resume, "--settings", input.settings, ...permissionArgs]
      : ["--session-id", input.sessionId, "--settings", input.settings, ...permissionArgs];

  // The initial prompt goes last as a positional arg; "--" ends option parsing so a
  // prompt starting with "-" can't be reinterpreted as a flag.
  return input.initialPrompt ? [...baseArgs, "--", input.initialPrompt] : baseArgs;
}
