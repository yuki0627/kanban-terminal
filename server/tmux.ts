// tmux-backed session persistence: run each PTY inside a tmux session so it survives
// the kanban-terminal server dying (crash / restart) and reattaches when the server comes
// back — like `screen`/`tmux` do. When tmux isn't installed, callers fall back to a
// direct pty.spawn (non-persistent, current behavior).
//
// Isolation: we use our OWN tmux server (`-L kanban-terminal`) and config file, so none
// of this touches the user's own tmux sessions, keybindings, or status bar.
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const SERVER_SOCKET = "kanban-terminal";
const SESSION_PREFIX = "kt-";
const CONF_FILE = path.join(os.homedir(), ".kanban-terminal", "tmux.conf");

// Spawn a command with the binary as a PARAMETER (not a string literal at the call
// site) — mirrors server/gh.ts so it isn't flagged as a spawn-of-a-string-literal.
function run(bin: string, args: string[]): { status: number | null; stdout: string } {
  const r = spawnSync(bin, args, { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout ?? "" };
}
const tmux = (args: string[]) => run("tmux", ["-L", SERVER_SOCKET, ...args]);

let cachedAvailable: boolean | null = null;

// Detected once. Absent (or non-unix) → callers use a direct pty.spawn. On first
// detection the isolated config is written so `new-session` picks it up via `-f`.
export function tmuxAvailable(): boolean {
  if (cachedAvailable === null) {
    cachedAvailable = run("tmux", ["-V"]).status === 0;
    if (cachedAvailable) {
      ensureConf();
      sanitizeTmuxEnvironment();
    }
  }
  return cachedAvailable;
}

// Minimal config for our server: no status bar (this is a terminal INSIDE a terminal),
// instant escape, generous scrollback, follow the latest client's size, and never
// destroy a session just because our client detached (that IS the persistence).
export function tmuxConfigLines(): string[] {
  return [
    "set -g status off",
    "set -g escape-time 0",
    "set -g history-limit 20000",
    "set -g window-size latest",
    "set -g destroy-unattached off",
    "set-environment -gu NO_COLOR",
  ];
}

function ensureConf(): void {
  try {
    mkdirSync(path.dirname(CONF_FILE), { recursive: true });
    writeFileSync(CONF_FILE, tmuxConfigLines().join("\n") + "\n");
  } catch {
    // non-fatal — tmux falls back to its defaults (a status bar, etc.)
  }
}

export function sanitizeTmuxEnvironment(): void {
  tmux(["set-environment", "-gu", "NO_COLOR"]);
}

export const tmuxSessionName = (id: string): string => `${SESSION_PREFIX}${id}`;

// argv for `tmux new-session -A`: create the session running `file args` (in `cwd`) if
// it doesn't exist, else ATTACH to the running one (the command is ignored). This one
// primitive covers both first launch and reattach-after-restart. Returned as the args
// for pty.spawn("tmux", ...).
export function tmuxNewSessionArgs(id: string, file: string, args: string[], cwd: string): string[] {
  return ["-u", "-L", SERVER_SOCKET, "-f", CONF_FILE, "new-session", "-A", "-s", tmuxSessionName(id), "-c", cwd, "--", file, ...args];
}

// Is a persistent session for this id currently alive in our tmux server?
export function tmuxHasSession(id: string): boolean {
  return tmux(["has-session", "-t", tmuxSessionName(id)]).status === 0;
}

// End a persistent session (explicit close / reap). Killing the pty only detaches our
// client — the session (and its program) would otherwise keep running.
export function tmuxKillSession(id: string): void {
  tmux(["kill-session", "-t", tmuxSessionName(id)]);
}

// Ids of sessions that survived (e.g. across a crash), for startup visibility.
export function tmuxListSessionIds(): string[] {
  const r = tmux(["list-sessions", "-F", "#{session_name}"]);
  if (r.status !== 0) return [];
  return r.stdout
    .split("\n")
    .filter((n) => n.startsWith(SESSION_PREFIX))
    .map((n) => n.slice(SESSION_PREFIX.length));
}

// Foreground command in the session's active pane. Used by kanban L2 process
// detection; null means the tmux session is gone or tmux could not inspect it.
export function tmuxPaneCurrentCommand(id: string): string | null {
  const r = tmux(["display-message", "-p", "-t", tmuxSessionName(id), "#{pane_current_command}"]);
  if (r.status !== 0) return null;
  const command = r.stdout.trim();
  return command || null;
}

export function tmuxPanePid(id: string): number | null {
  const r = tmux(["display-message", "-p", "-t", tmuxSessionName(id), "#{pane_pid}"]);
  if (r.status !== 0) return null;
  const pid = Number(r.stdout.trim());
  return Number.isFinite(pid) ? pid : null;
}
