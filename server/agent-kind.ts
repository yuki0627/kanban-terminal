import path from "node:path";
import { buildClaudeArgs, type ClaudeArgsInput } from "./claude-args.js";
import { parseJsonl } from "./transcript.js";

export interface AgentKindDefinition {
  kind: "claude";
  matchesCommand(command: string): boolean;
  matchesProcessArgs(args: string): boolean;
  resumeCommand(input: ClaudeArgsInput): string[];
  titleFromTranscript(raw: string): string | null;
}

const SCRIPT_EXT_RE = /\.(?:cjs|mjs|js|ts)$/i;
const RUNNER_COMMANDS = new Set(["node", "bun", "deno", "npx", "pnpm", "yarn", "npm"]);

function normalizedCommand(command: string): string {
  return path.basename(command).toLowerCase();
}

function normalizedArgCommand(token: string): string {
  return normalizedCommand(token.replace(/^['"]|['"]$/g, "")).replace(SCRIPT_EXT_RE, "");
}

export function createClaudeAgentKind(claudeBin: string): AgentKindDefinition {
  const commands = new Set(["claude", path.basename(claudeBin)].filter(Boolean).map((v) => v.toLowerCase()));
  const matchesCommand = (command: string): boolean => commands.has(normalizedCommand(command));
  const matchesProcessArgs = (args: string): boolean => {
    const tokens = args.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return false;
    const command = normalizedArgCommand(tokens[0]);
    if (commands.has(command)) return true;
    if (!RUNNER_COMMANDS.has(command)) return false;
    return tokens.slice(1).some((token) => commands.has(normalizedArgCommand(token)));
  };
  return {
    kind: "claude",
    matchesCommand,
    matchesProcessArgs,
    resumeCommand: buildClaudeArgs,
    titleFromTranscript(raw: string): string | null {
      for (const o of parseJsonl(raw)) {
        if (o.type === "ai-title" && typeof o.aiTitle === "string" && o.aiTitle.trim()) return o.aiTitle.trim();
      }
      return null;
    },
  };
}

export function detectAgentProcess(agents: ReadonlyArray<AgentKindDefinition>, command: string, argsRows: ReadonlyArray<string>): AgentKindDefinition | null {
  return agents.find((agent) => agent.matchesCommand(command) || argsRows.some((args) => agent.matchesProcessArgs(args))) ?? null;
}
