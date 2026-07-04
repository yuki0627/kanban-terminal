// Docker sandbox for the SINGLE-VIEW interactive Claude session (opt-in, default off).
// Runs `claude` inside a container to CONTAIN it: it can't reach the host filesystem
// outside the bind-mounts, host processes, or arbitrary host ports. It is NOT full
// isolation — the project directory and ~/.claude are bind-mounted READ-WRITE by design
// (Claude edits your code and writes its transcript/auth), so those specific host paths
// stay mutable from inside. The container reaches the host's GUI MCP + activity hooks
// over host.docker.internal. The grid keeps its host + tmux path — sandbox and tmux are
// alternative spawn wrappers.
//
// Verified in Phase 0 (#202): a sandboxed claude authenticates via the mounted ~/.claude
// and connects to the host GUI MCP over host.docker.internal.
import { spawnSync } from "node:child_process";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const IMAGE = process.env.MULMOTERMINAL_SANDBOX_IMAGE || "mulmoterminal-sandbox";
const CONTAINER_HOME = "/home/node";

// The hostname a container uses to reach the host (Docker Desktop provides it natively;
// Linux gets it via `--add-host host.docker.internal:host-gateway`).
export const SANDBOX_HOST = "host.docker.internal";

// Opt-in, default off. Enable with MULMOTERMINAL_SANDBOX=1.
export function sandboxEnabled(): boolean {
  const v = process.env.MULMOTERMINAL_SANDBOX;
  return v === "1" || v === "true";
}

// Rewrite a host-loopback URL so it's reachable from inside the container. Same regex
// MulmoClaude uses: anchored at the scheme, only localhost/127.0.0.1 followed by :/ or end.
export function rewriteLoopbackForDocker(url: string): string {
  return url.replace(/^(https?:\/\/)(localhost|127\.0\.0\.1)(?=[:/]|$)/, `$1${SANDBOX_HOST}`);
}

export const sandboxContainerName = (sessionId: string): string => `mulmoterminal-${sessionId}`;

// Bin as a parameter (not a spawn-of-a-string-literal), mirroring server/gh.ts + tmux.ts.
function run(bin: string, args: string[]): { status: number | null } {
  return { status: spawnSync(bin, args, { stdio: "ignore" }).status };
}

// Is Docker usable (daemon reachable)? Only a POSITIVE result is cached — a failed check
// (e.g. the daemon still starting when the server boots) is retried on the next spawn, so
// transient unavailability doesn't permanently disable sandboxing until a restart.
let cachedDockerOk = false;
export function dockerAvailable(): boolean {
  if (!cachedDockerOk) cachedDockerOk = run("docker", ["info"]).status === 0;
  return cachedDockerOk;
}

// A per-session ~/.claude.json for the container. We deliberately do NOT mount the
// host's ~/.claude.json: it records a `native` install at ~/.local/bin (which doesn't
// exist in the container, so claude warns "missing or broken"), and mounting it
// read-write would let the container mutate the user's global config. Instead we mount
// auth via ~/.claude/.credentials.json (the dir) and a minimal generated config that
// marks onboarding done and pre-trusts the workspace (so no theme / trust prompts).
// Under the app's own (user-owned) home, not a world-writable temp dir.
const SANDBOX_DIR = path.join(os.homedir(), ".mulmoterminal", "sandbox");
export function sandboxClaudeConfigPath(sessionId: string): string {
  return path.join(SANDBOX_DIR, `claude-${sessionId}.json`);
}

export function writeSandboxClaudeConfig(sessionId: string, cwd: string): string {
  mkdirSync(SANDBOX_DIR, { recursive: true });
  const file = sandboxClaudeConfigPath(sessionId);
  const config = {
    hasCompletedOnboarding: true,
    theme: "dark",
    hasSeenAutoModeEntryWarning: true,
    // cwd is mounted at its SAME path in the container, so this key matches there.
    projects: {
      [cwd]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true, projectOnboardingSeenCount: 1, allowedTools: [] },
    },
  };
  writeFileSync(file, JSON.stringify(config));
  return file;
}

// Best-effort teardown: force-remove the container (killing the `docker run` client
// alone can leave it behind) and delete the throwaway per-session config. Used before a
// spawn (clear stale) and on reap.
export function cleanupSandbox(sessionId: string): void {
  run("docker", ["rm", "-f", sandboxContainerName(sessionId)]);
  rmSync(sandboxClaudeConfigPath(sessionId), { force: true });
}

// The `docker run` argv that runs interactive `claude` in the sandbox. The workspace is
// bind-mounted at its SAME absolute path so claude's transcript encodes identically to
// the host (~/.claude/projects/<encoded-cwd>) — resume interoperates with host sessions.
// ~/.claude (dir) is mounted for auth + transcripts; `claudeConfigPath` is the generated
// per-session ~/.claude.json. `claudeArgs` already have their --settings/--mcp-config
// URLs rewritten to host.docker.internal by the caller.
export function buildDockerRunArgs(sessionId: string, claudeArgs: string[], cwd: string, claudeConfigPath: string): string[] {
  const claudeDir = path.join(os.homedir(), ".claude");
  return [
    "run",
    "--rm",
    "-it",
    "--name",
    sandboxContainerName(sessionId),
    "--add-host",
    "host.docker.internal:host-gateway",
    "-e",
    `HOME=${CONTAINER_HOME}`,
    "-e",
    "DISABLE_AUTOUPDATER=1", // ephemeral container — never self-update the CLI
    "-v",
    `${cwd}:${cwd}`,
    "-v",
    `${claudeDir}:${CONTAINER_HOME}/.claude`,
    "-v",
    `${claudeConfigPath}:${CONTAINER_HOME}/.claude.json`,
    "-w",
    cwd,
    IMAGE,
    "claude",
    ...claudeArgs,
  ];
}
