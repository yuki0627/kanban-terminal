// Docker sandbox for the SINGLE-VIEW interactive Claude session (opt-in, default off).
// Runs `claude` inside a container so an untrusted workspace can't touch the host; the
// container reaches the host's GUI MCP + activity hooks over host.docker.internal. The
// grid keeps its host + tmux path — sandbox and tmux are alternative spawn wrappers.
//
// Verified in Phase 0 (#202): a sandboxed claude authenticates via the mounted ~/.claude
// and connects to the host GUI MCP over host.docker.internal.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
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

// Is Docker usable (daemon reachable)? Cached — a missing/stopped daemon means the
// caller should fall back to the host spawn rather than hang.
let cachedDockerOk: boolean | null = null;
export function dockerAvailable(): boolean {
  if (cachedDockerOk === null) cachedDockerOk = run("docker", ["info"]).status === 0;
  return cachedDockerOk;
}

// Best-effort remove a sandbox container (clear a stale one before spawn, or on reap —
// killing the `docker run` client alone can leave the container behind).
export function removeSandboxContainer(sessionId: string): void {
  run("docker", ["rm", "-f", sandboxContainerName(sessionId)]);
}

// The `docker run` argv that runs interactive `claude` in the sandbox. The workspace is
// bind-mounted at its SAME absolute path so claude's transcript encodes identically to
// the host (~/.claude/projects/<encoded-cwd>) — resume interoperates with host sessions.
// ~/.claude (+ .claude.json) is mounted for auth + transcripts. `claudeArgs` already have
// their --settings/--mcp-config URLs rewritten to host.docker.internal by the caller.
export function buildDockerRunArgs(sessionId: string, claudeArgs: string[], cwd: string): string[] {
  const claudeDir = path.join(os.homedir(), ".claude");
  const claudeJson = path.join(os.homedir(), ".claude.json");
  const jsonMount = existsSync(claudeJson) ? ["-v", `${claudeJson}:${CONTAINER_HOME}/.claude.json`] : [];
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
    "-v",
    `${cwd}:${cwd}`,
    "-v",
    `${claudeDir}:${CONTAINER_HOME}/.claude`,
    ...jsonMount,
    "-w",
    cwd,
    IMAGE,
    "claude",
    ...claudeArgs,
  ];
}
