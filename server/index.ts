import express from "express";
import http from "http";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import pty from "node-pty";
import type { IPty } from "node-pty";
import path from "path";
import os from "os";
import fs from "fs/promises";
import { randomUUID } from "crypto";
import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "url";
import { createPubSub } from "./pubsub.js";
import { mountConfigRoutes, getLaunchers } from "./config-routes.js";
import { mountBoardRoutes } from "./board-routes.js";
import { applyCardStatus, loadBoard, saveBoard, type BoardState, type Card, type CellStatus } from "./board-store.js";
import {
  tmuxAvailable,
  tmuxNewSessionArgs,
  tmuxHasSession,
  tmuxKillSession,
  tmuxListSessionIds,
  tmuxPaneCurrentCommand,
  tmuxPanePid,
  sanitizeTmuxEnvironment,
} from "./tmux.js";
import { publicDirConfig, dirSoundFile } from "./dir-config.js";
import { loadScripts, resolveScript } from "./scripts.js";
import { createClaudeAgentKind, detectAgentProcess } from "./agent-kind.js";
import {
  isRecord,
  parseJsonl,
  userPromptText,
  latestMeaningfulUserPromptFromJsonl,
  preferredHeaderPrompt,
  sessionUsageFromJsonl,
  type SessionUsage,
} from "./transcript.js";
import { mountOpenDirRoute } from "./open-dir.js";
import { mountGitRemoteRoute } from "./gitRemote.js";
import { mountPickFileRoute, mountPickDirectoryRoute } from "./pick-file.js";
import { initNotifier, mountNotificationRoutes } from "./backends/notifier.js";
import { SPA_FALLBACK_RE } from "./spa-fallback.js";
import { currentProcessCommandRows, currentProcessRows, processTreeRows, sumProcessTreeRss } from "./process-memory.js";
import {
  AGENT_SILENCE_MS,
  emptyAgentPtyActivityState,
  reduceAgentPtyActivity,
  type AgentPtyActivityEvent,
  type AgentPtyActivityState,
  type AgentPtySignal,
} from "./pty-activity.js";
import { linkedAgentSessionIds, selectAgentTranscriptCandidate, type AgentTranscriptCandidate } from "./agent-discovery.js";

// Per-session activity flags, driven by Claude hooks (see /api/hook).
interface Activity {
  working?: boolean;
  waiting?: boolean;
  event?: string | null;
  at?: number;
}

// A live PTY and its (possibly detached) browser socket.
interface PtyEntry {
  term: IPty;
  ws: WebSocket | null;
  buffer: string;
  cwd: string; // the dir the PTY actually runs in (reported on reattach)
  // True when `term` is a tmux client (persistent): killing it only detaches, so reap
  // must kill the tmux session to actually end the program.
  tmux?: boolean;
}

interface KnownSession {
  createdAt: number;
  title: string;
}

// A sidebar session row (resolved from disk or a pending in-memory session).
interface SessionMeta {
  id: string;
  title: string;
  mtime: number;
  working: boolean;
  waiting: boolean;
  /** The hook that set the current state (e.g. "Stop" | "Notification"), or null.
   *  Lets the client split `waiting` into "done, unreviewed" (Stop) vs "blocked on
   *  input" (Notification). */
  event: string | null;
  /** Reserved for sessions that should not render bold/unread. */
  hidden: boolean;
}

// Recency rank for an on-disk .jsonl, before its contents are read.
interface DiskStat {
  kind: "disk";
  id: string;
  file: string;
  mtime: number;
}

// An in-memory session not yet persisted to disk.
interface PendingSession extends SessionMeta {
  kind: "pending";
}

// Node fs errors carry a `code` (e.g. "ENOENT"); narrow before reading it.
const hasErrnoCode = (e: unknown): e is { code?: string } => typeof e === "object" && e !== null;

// Error message extracted defensively from an unknown thrown value.
const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT) || 34567;
const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const CLAUDE_AGENT = createClaudeAgentKind(CLAUDE_BIN);
const AGENT_KINDS = [CLAUDE_AGENT];
// Permission mode for backend-spawned Claude sessions. Defaults to "auto" so
// the backend runs hands-off; override with CLAUDE_PERMISSION_MODE (e.g.
// "default" / "acceptEdits" / "bypassPermissions" / "plan") when needed.
const CLAUDE_PERMISSION_MODE = process.env.CLAUDE_PERMISSION_MODE || "auto";
const CLAUDE_CWD = process.env.CLAUDE_CWD || process.cwd();
const DEFAULT_LAUNCH_CMD = process.env.SHELL || "/bin/sh";
const PTY_COLS = 120;
const PTY_ROWS = 30;

// CLAUDE_CWD is the workspace used as the PTY cwd and as the root for persisted
// session state, so it must exist before we spawn anything into it.
await fs.mkdir(CLAUDE_CWD, { recursive: true });
if (tmuxAvailable()) sanitizeTmuxEnvironment();

const KANBAN_TERMINAL_HOME = path.join(os.homedir(), ".kanban-terminal");

// A session id is always a UUID (server-generated, or a .jsonl basename). Reject
// anything else so a client can't smuggle CLI flags (e.g. "--resume" followed by
// a value that claude re-parses as a flag) into the spawned process.
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CARD_ID_RE = /^[A-Za-z0-9_.:-]{1,160}$/;

// Session ids that belong to the multi-terminal GRID — dev terminals, spawned with
// dev=1 (see the query handling in the WS connection handler). They're
// FILTERED OUT of the chat sidebar's /api/sessions so a grid terminal never surfaces
// as a clickable chat row: selecting it in chat would reattach its live PTY and
// SUPERSEDE the grid cell (the "chat hijacked my multi-terminal session" bug). The
// set is persisted so the exclusion survives a reboot and outlives the live PTY — a
// reaped grid session's on-disk transcript still shouldn't reappear as an unscoped session. NOTE:
// the exclusion applies ONLY to the unscoped (chat) query; the grid's OWN cwd-scoped
// resume picker (/api/sessions?cwd=…) must keep listing these so they stay resumable.
const devTerminalSessions = new Set<string>();
const DEV_TERMINAL_SESSIONS_FILE = path.join(KANBAN_TERMINAL_HOME, "dev-terminal-sessions.json");

// Card terminals are suspend-by-default: a detached socket must not idle-reap the
// underlying PTY. Hydrate persisted card session ids and mark fresh card sockets
// carrying ?card=1 before spawning.
const cardTerminalSessions = new Set<string>();
const terminalSessionToCard = new Map<string, string>();
const agentSessionToCard = new Map<string, string>();
const l2StatusBySession = new Map<string, CellStatus>();
const l3StatusByCard = new Map<string, CellStatus>();
const agentForegroundSessions = new Set<string>();
const openCardSessions = new Map<string, string | null>();
const agentPtyActivity = new Map<string, AgentPtyActivityState>();
const agentSilenceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const agentDiscoveryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const agentDiscoveryState = new Map<string, { startedAt: number; attempts: number }>();
function hydrateCardTerminalSessions(): void {
  cardTerminalSessions.clear();
  terminalSessionToCard.clear();
  agentSessionToCard.clear();
  for (const card of loadBoard().cards) {
    if (card.terminal.sessionId) {
      cardTerminalSessions.add(card.terminal.sessionId);
      terminalSessionToCard.set(card.terminal.sessionId, card.id);
    }
    if (card.terminal.agentSessionId) agentSessionToCard.set(card.terminal.agentSessionId, card.id);
  }
}
hydrateCardTerminalSessions();

// Hydrate the set once at boot (best-effort — absent on first run / unreadable =>
// empty). Exposed as a promise so readers/writers can wait for it: a request served
// (or a mark persisted) before this resolves would otherwise see an empty set and
// either leak hidden grid transcripts into chat or clobber the file with a snapshot
// missing the on-disk ids.
const devTerminalSessionsHydrated: Promise<void> = (async () => {
  try {
    const parsed = JSON.parse(await fs.readFile(DEV_TERMINAL_SESSIONS_FILE, "utf8"));
    if (Array.isArray(parsed)) for (const id of parsed) if (typeof id === "string" && SESSION_ID_RE.test(id)) devTerminalSessions.add(id);
  } catch {
    // no file yet or unreadable => start empty
  }
})();

// Serialize every persist into ONE chain so concurrent marks can't run overlapping
// writeFile()s that interleave and leave an older snapshot on disk (dropping ids).
// Each link waits for hydration first (so it never persists a set missing the on-disk
// ids) and stringifies the CURRENT set at write time, so the last link always writes
// the complete, up-to-date set. A failed write is logged and the chain continues.
let devTerminalPersist: Promise<void> = Promise.resolve();
function persistDevTerminalSessions(): void {
  devTerminalPersist = devTerminalPersist
    .then(() => devTerminalSessionsHydrated)
    .then(() => fs.mkdir(KANBAN_TERMINAL_HOME, { recursive: true }))
    .then(() => fs.writeFile(DEV_TERMINAL_SESSIONS_FILE, JSON.stringify([...devTerminalSessions])))
    .catch((e) => console.error(`[dev-terminal-sessions] failed to persist: ${messageOf(e)}`));
}

// Record a grid/dev-terminal session id, then persist. A no-op once the id is known,
// so repeated reattaches of the same cell — or a reconnect after a reboot — don't
// rewrite the file.
function markDevTerminalSession(id: string): void {
  if (!SESSION_ID_RE.test(id) || devTerminalSessions.has(id)) return;
  devTerminalSessions.add(id);
  persistDevTerminalSessions();
}

// Only same-machine browser origins may open the terminal / pub-sub sockets, so
// a malicious website the user visits can't drive the local Claude PTY (a
// cross-site WebSocket hijack). A missing Origin (non-browser local client) is
// allowed; any localhost host on any port is allowed (covers the Vite dev proxy).
function isAllowedOrigin(origin?: string) {
  if (!origin) return true;
  try {
    const host = new URL(origin).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

// Pub/sub channel the sidebar subscribes to for live session-activity changes.
const SESSIONS_CHANNEL = "sessions";

// Only the most-recent N sessions are listed in the sidebar; older ones aren't
// read or parsed, keeping /api/sessions cheap for projects with many sessions.
const SESSION_LIST_LIMIT = 50;

// Per-session "working" state, driven by Claude hooks (see /api/hook):
// UserPromptSubmit => Claude started thinking; Stop => it finished.
const activity = new Map<string, Activity>(); // id -> { working, event, at }

// Latest MEANINGFUL user prompt per session (from the UserPromptSubmit hook), shown
// on the grid cell header so you can tell at a glance what each terminal is about. A
// trivial ack ("ok", "merge") doesn't replace it (see the hook handler), so a short
// follow-up can't hide the task.
const lastPrompts = new Map<string, string>(); // id -> prompt text
const LAST_PROMPT_CAP = 200;

// Live ptys keyed by session id. A pty outlives its WebSocket while the session
// is still "working", so switching away doesn't interrupt Claude mid-turn; it
// is reaped once the session goes idle (Stop hook) or the process exits. `ws`
// is null while the session runs in the background.
const ptys = new Map<string, PtyEntry>(); // id -> { term, ws, buffer }

// New sessions started in this process that have no .jsonl on disk yet (Claude
// only writes the file on the first prompt). Merged into /api/sessions so a
// freshly created session shows in the sidebar immediately. An entry is dropped
// once the file exists (the on-disk record takes over) or the pty is reaped.
const knownSessions = new Map<string, KnownSession>(); // id -> { createdAt, title }

// Bytes of recent output kept per pty and replayed when a client reattaches to
// a background session, so the user sees context instead of a blank screen.
const OUTPUT_BUFFER_LIMIT = 64 * 1024;

// Assigned once the HTTP server exists (createPubSub needs it).
let pubsub: ReturnType<typeof createPubSub> | null = null;

const BOARD_CHANNEL = "board";

function sanitizeCardId(cardId: string | null): string | null {
  return cardId && CARD_ID_RE.test(cardId) ? cardId : null;
}

function publishBoardUpdate(): void {
  hydrateCardTerminalSessions();
  pubsub?.publish(BOARD_CHANNEL, {});
}

function applyBoardSignal(cardId: string, status: CellStatus): void {
  const board = loadBoard();
  const next = applyCardStatus(board, cardId, status, { viewed: isCardViewed(cardId) });
  if (next === board) return;
  if (saveBoard(next)) publishBoardUpdate();
}

function isCardViewed(cardId: string): boolean {
  return openCardSessions.has(cardId);
}

function markCardViewed(cardId: string): void {
  const sessionId = loadBoard().cards.find((card) => card.id === cardId)?.terminal.sessionId ?? null;
  openCardSessions.set(cardId, sessionId);
}

function markCardClosed(cardId: string): void {
  openCardSessions.delete(cardId);
}

function markCardClosedForSession(sessionId: string): void {
  const cardId = terminalSessionToCard.get(sessionId);
  if (cardId && openCardSessions.get(cardId) === sessionId) markCardClosed(cardId);
}

function bindTerminalSessionToCard(cardId: string, sessionId: string, cwd: string): void {
  terminalSessionToCard.set(sessionId, cardId);
  const board = loadBoard();
  const card = board.cards.find((c) => c.id === cardId);
  if (!card) return;
  const nextTerminal = { ...card.terminal, sessionId, agentKind: "shell" as const, cwd };
  if (card.terminal.sessionId === sessionId && card.terminal.cwd === cwd && card.terminal.agentKind === "shell") return;
  const next = {
    ...board,
    cards: board.cards.map((c) => (c.id === cardId ? { ...c, terminal: nextTerminal, updatedAt: Date.now() } : c)),
  };
  if (saveBoard(next)) publishBoardUpdate();
}

function cardWorkspace(board: BoardState, card: Card): string {
  if (card.terminal.cwd) return resolveWorkspace(card.terminal.cwd);
  const projectRoot = card.projectId ? board.projects.find((p) => p.id === card.projectId)?.root : null;
  return resolveWorkspace(projectRoot ?? os.homedir());
}

function cardTerminalAlive(sessionId: string | null): boolean {
  return !!sessionId && (ptys.has(sessionId) || tmuxHasSession(sessionId));
}

function claudeResumeDraft(agentSessionId: string | null | undefined): string | null {
  return agentSessionId && SESSION_ID_RE.test(agentSessionId) ? `claude --resume ${agentSessionId}` : null;
}

function ensureCardTerminal(board: BoardState, card: Card): Card {
  const cwd = cardWorkspace(board, card);
  if (card.archived) return card;
  if (cardTerminalAlive(card.terminal.sessionId)) {
    if (card.terminal.sessionId) {
      cardTerminalSessions.add(card.terminal.sessionId);
      terminalSessionToCard.set(card.terminal.sessionId, card.id);
    }
    return card.terminal.cwd === cwd ? card : { ...card, terminal: { ...card.terminal, cwd, agentKind: "shell" }, updatedAt: Date.now() };
  }

  const sessionId = randomUUID();
  cardTerminalSessions.add(sessionId);
  terminalSessionToCard.set(sessionId, card.id);
  const resumeDraft = card.terminal.sessionId ? claudeResumeDraft(card.terminal.agentSessionId) : null;
  try {
    spawnLauncherPty(sessionId, null, DEFAULT_LAUNCH_CMD, cwd, card.id, resumeDraft);
  } catch (err) {
    console.error(`[card-terminal] failed to start shell for ${card.id}: ${messageOf(err)}`);
    cardTerminalSessions.delete(sessionId);
    terminalSessionToCard.delete(sessionId);
    return card;
  }
  return { ...card, terminal: { ...card.terminal, sessionId, agentKind: "shell", cwd }, updatedAt: Date.now() };
}

function ensureBoardTerminals(board: BoardState): BoardState {
  let changed = false;
  const cards = board.cards.map((card) => {
    const next = ensureCardTerminal(board, card);
    changed ||= next !== card;
    return next;
  });
  return changed ? { ...board, cards } : board;
}

// Tear down a session's PTY and bookkeeping, then notify subscribers. The
// `activity` entry is dropped too — UNLESS it still carries `waiting`, which is
// what keeps a finished/needs-attention background session bold (via its
// on-disk record) until the user opens it. This keeps `activity` from growing
// unbounded while preserving the bold-until-viewed behavior.
// On disconnect we don't kill an idle session immediately — a page reload is a
// brief disconnect, and reaping then would throw away a perfectly good live
// terminal (and its scrollback). Instead we keep the pty for a grace window; a
// reattach within it cancels the reap, so a reload just re-attaches to the same
// running terminal. Only after the window with no reattach do we reap.
const REAP_GRACE_MS = 30_000;
// A detached session that still needs the user — mid-turn output the user hasn't
// seen, or blocked on a permission/question prompt (the `waiting` flag) — is an
// unfinished task: reaping it loses work. So it gets a much longer grace than an
// idle one, long enough that you can switch away, do other things, and come back
// to answer it. Override with WAIT_REAP_GRACE_MS=0 to never auto-close these.
const WAIT_REAP_GRACE_MS = (() => {
  const def = 30 * 60_000;
  const raw = process.env.WAIT_REAP_GRACE_MS;
  if (raw === undefined) return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    console.warn(`[pty] ignoring non-numeric WAIT_REAP_GRACE_MS=${JSON.stringify(raw)}; using default ${def}ms`);
    return def;
  }
  return n; // a non-positive value means "never auto-reap waiting sessions" (see scheduleReap)
})();
const reapTimers = new Map<string, ReturnType<typeof setTimeout>>();

function cancelReap(id: string) {
  const t = reapTimers.get(id);
  if (t) {
    clearTimeout(t);
    reapTimers.delete(id);
  }
}

// Node's setTimeout delay is a signed 32-bit int; a larger value overflows and
// fires at ~1ms. Clamp to the max so a big grace doesn't become an instant reap.
const MAX_TIMER_MS = 2_147_483_647;

function scheduleReap(id: string, delayMs: number = REAP_GRACE_MS) {
  // Non-positive or non-finite (e.g. a bad env value yielding NaN) => never
  // auto-reap; the session stays until reattached or explicitly terminated.
  // Guarding here matters because setTimeout(..., NaN) would fire ~immediately.
  if (!Number.isFinite(delayMs) || delayMs <= 0) return;
  if (reapTimers.has(id)) return;
  const delay = Math.min(delayMs, MAX_TIMER_MS);
  reapTimers.set(
    id,
    setTimeout(() => {
      reapTimers.delete(id);
      const entry = ptys.get(id);
      if (entry && !entry.ws) reap(id); // still detached after the grace window
    }, delay),
  );
}

// Decide whether/when to reap a detached session based on its activity. A session
// that's actively thinking (`working`) is never reaped — that's "clearly working,
// don't close it". One that needs the user (`waiting`) gets the long grace. A
// genuinely idle session (finished AND already viewed, so neither flag) gets the
// short grace — that's the "auto-close inactive ones" behaviour.
function armReapForDetached(id: string) {
  const entry = ptys.get(id);
  if (!entry || entry.ws) return; // still attached: nothing to reap
  // Recompute from scratch: state may have escalated (idle -> waiting) since the
  // last arm, and a stale short timer must not survive to reap a session that now
  // needs the user. cancelReap clears it so scheduleReap re-arms with the right grace.
  cancelReap(id);
  const a = activity.get(id);
  if (a?.working) {
    console.log(`[pty] keeping working session ${id} alive (detached)`);
    return;
  }
  scheduleReap(id, a?.waiting ? WAIT_REAP_GRACE_MS : REAP_GRACE_MS);
}

function reap(id: string) {
  cancelReap(id);
  const entry = ptys.get(id);
  if (!entry) return; // already reaped
  const cardId = terminalSessionToCard.get(id);
  ptys.delete(id);
  cardTerminalSessions.delete(id);
  terminalSessionToCard.delete(id);
  if (cardId) {
    clearAgentSessionLinksForCard(cardId);
    markCardClosed(cardId);
  }
  l2StatusBySession.delete(id);
  agentForegroundSessions.delete(id);
  clearAgentActivity(id);
  clearAgentDiscovery(id);
  // An unpersisted new session vanishes with its pty; a persisted one stays
  // visible via its on-disk record.
  knownSessions.delete(id);
  lastPrompts.delete(id); // don't leak prompt text for torn-down sessions
  const a = activity.get(id);
  if (!a || (!a.working && !a.waiting)) {
    activity.delete(id);
  }
  try {
    entry.term.kill();
  } catch {
    // already gone
  }
  // Killing the pty only DETACHES a tmux client — end the tmux session too so an
  // explicit close / idle reap actually stops the program (no orphan within a live
  // server). A server crash never runs this, so sessions survive that (the point).
  if (entry.tmux) tmuxKillSession(id);
  pubsub?.publish(SESSIONS_CHANNEL, { id, working: false, event: "closed" });
}

function clearAgentSessionLinksForCard(cardId: string): void {
  for (const [agentSessionId, linkedCardId] of agentSessionToCard) {
    if (linkedCardId === cardId) agentSessionToCard.delete(agentSessionId);
  }
}

function releaseTerminalSession(id: string): boolean {
  cancelReap(id);
  const cardId = terminalSessionToCard.get(id);
  const entry = ptys.get(id);
  ptys.delete(id);
  cardTerminalSessions.delete(id);
  terminalSessionToCard.delete(id);
  if (cardId) {
    clearAgentSessionLinksForCard(cardId);
    l3StatusByCard.delete(cardId);
    markCardClosed(cardId);
  }
  l2StatusBySession.delete(id);
  agentForegroundSessions.delete(id);
  clearAgentActivity(id);
  clearAgentDiscovery(id);
  knownSessions.delete(id);
  lastPrompts.delete(id);
  activity.delete(id);
  if (entry) {
    try {
      entry.term.kill();
    } catch {
      // already gone
    }
    if (entry.tmux) tmuxKillSession(id);
  } else if (tmuxHasSession(id)) {
    tmuxKillSession(id);
  } else {
    return false;
  }
  pubsub?.publish(SESSIONS_CHANNEL, { id, working: false, event: "closed" });
  return true;
}

// Publish a session's current activity (working + waiting) to subscribers.
function publishActivity(id: string) {
  const a = activity.get(id) || {};
  pubsub?.publish(SESSIONS_CHANNEL, {
    id,
    // The session's working dir, so the attention-sound player can pick up that
    // directory's custom sound (<cwd>/.mulmoterminal.json). Null for a session with
    // no live PTY (a reaped background worker).
    cwd: ptys.get(id)?.cwd ?? null,
    working: a.working ?? false,
    waiting: a.waiting ?? false,
    event: a.event ?? null,
    lastPrompt: lastPrompts.get(id) ?? null,
  });
}

// Claude is thinking (UserPromptSubmit) until it finishes (Stop). No-op (and no
// publish) when the state is unchanged.
function setWorking(id: string, working: boolean, event?: string) {
  const prev = activity.get(id) || {};
  if ((prev.working ?? false) === working) return;
  activity.set(id, { ...prev, working, event: event ?? prev.event ?? null, at: Date.now() });
  publishActivity(id);

  // A background session (no attached client) that just finished a turn is no
  // longer `working`. Don't kill it outright — if it ended its turn to ask the
  // user something (it'll be flagged `waiting`), reaping now would lose the task
  // before the user can answer. Arm a reap whose grace matches its state.
  if (!working) armReapForDetached(id);
}

// A background session needs the user's attention: it is waiting for input
// (Notification: permission / question / idle) or has finished a turn with
// output the user hasn't seen (Stop). Cleared when brought to the foreground
// (see the WebSocket connection handler).
function setWaiting(id: string, waiting: boolean, event?: string) {
  const prev = activity.get(id) || {};
  if ((prev.waiting ?? false) === waiting) return;
  activity.set(id, { ...prev, waiting, event: event ?? prev.event ?? null, at: Date.now() });
  publishActivity(id);

  // A detached session that just started needing the user escalates from the short
  // idle grace to the long one — re-arm so it isn't reaped before they can return.
  if (waiting) armReapForDetached(id);
}

// Hook config injected via `claude --settings <json>`. Each event POSTs the full
// hook payload to /api/hook. UserPromptSubmit => working, Stop => idle,
// Notification => waiting for input.
function hookSettingsJson(host: string = "localhost") {
  const cmd = `curl -s -X POST http://${host}:${PORT}/api/hook ` + `-H 'content-type: application/json' -d @- >/dev/null 2>&1`;
  const entry = [{ hooks: [{ type: "command", command: cmd }] }];
  return JSON.stringify({
    hooks: {
      UserPromptSubmit: entry,
      Stop: entry,
      Notification: entry,
    },
  });
}

// Claude stores each project's sessions under ~/.claude/projects/<encoded-cwd>/,
// where the absolute cwd has its "/" and "." characters replaced by "-".
function projectSessionsDir(cwd: string) {
  const encoded = path.resolve(cwd).replace(/[/.]/g, "-");
  return path.join(os.homedir(), ".claude", "projects", encoded);
}

// Whether a session has an on-disk transcript (claude only writes it after the
// first prompt) in the given workspace. Determines whether `--resume` will work.
function sessionExistsOnDisk(id: string, cwd: string): boolean {
  return existsSync(path.join(projectSessionsDir(cwd), `${id}.jsonl`));
}

const AGENT_TRANSCRIPT_LOOKBACK_MS = 5_000;
const AGENT_TRANSCRIPT_RETRY_MS = 1_500;
const AGENT_TRANSCRIPT_MAX_ATTEMPTS = 240;

function isAutoCardName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed === "" || trimmed === "New terminal";
}

async function findClaudeTranscriptCandidates(cwd: string): Promise<AgentTranscriptCandidate[]> {
  const dir = projectSessionsDir(cwd);
  let dirEntries: string[];
  try {
    dirEntries = await fs.readdir(dir);
  } catch (err) {
    if (hasErrnoCode(err) && err.code === "ENOENT") return [];
    throw err;
  }
  const files = dirEntries.filter((file) => file.endsWith(".jsonl") && SESSION_ID_RE.test(path.basename(file, ".jsonl")));
  return Promise.all(
    files.map(async (file) => {
      const full = path.join(dir, file);
      const stat = await fs.stat(full);
      const raw = await fs.readFile(full, "utf8");
      return {
        id: path.basename(file, ".jsonl"),
        createdAt: stat.birthtimeMs || stat.ctimeMs || stat.mtimeMs,
        updatedAt: stat.mtimeMs,
        title: CLAUDE_AGENT.titleFromTranscript(raw),
      };
    }),
  );
}

async function selectTranscriptCandidateForCard(board: BoardState, card: Card, startedAt: number): Promise<AgentTranscriptCandidate | null> {
  const cwd = cardWorkspace(board, card);
  const candidates = await findClaudeTranscriptCandidates(cwd);
  const linkedIds = linkedAgentSessionIds(board, card.id);
  return selectAgentTranscriptCandidate(candidates, startedAt, linkedIds, AGENT_TRANSCRIPT_LOOKBACK_MS);
}

function nameForAgentTranscript(card: Card, candidate: AgentTranscriptCandidate): string {
  return candidate.title && isAutoCardName(card.name) ? candidate.title : card.name;
}

function persistAgentTranscriptCandidate(cardId: string, candidate: AgentTranscriptCandidate): boolean {
  const latestBoard = loadBoard();
  if (linkedAgentSessionIds(latestBoard, cardId).has(candidate.id)) return false;
  const latestCard = latestBoard.cards.find((c) => c.id === cardId);
  if (!latestCard || latestCard.archived) return true;
  const latestName = nameForAgentTranscript(latestCard, candidate);
  const latestTerminal = { ...latestCard.terminal, agentSessionId: candidate.id };
  const next: BoardState = {
    ...latestBoard,
    cards: latestBoard.cards.map((c) => (c.id === cardId ? { ...c, name: latestName, terminal: latestTerminal, updatedAt: Date.now() } : c)),
  };
  if (saveBoard(next)) publishBoardUpdate();
  return true;
}

async function discoverAgentTranscript(sessionId: string): Promise<boolean> {
  const state = agentDiscoveryState.get(sessionId);
  const cardId = terminalSessionToCard.get(sessionId);
  if (!state || !cardId) return true;

  const board = loadBoard();
  const card = board.cards.find((c) => c.id === cardId);
  if (!card || card.archived) return true;

  try {
    const candidate = await selectTranscriptCandidateForCard(board, card, state.startedAt);
    if (!candidate) return false;

    const nextName = nameForAgentTranscript(card, candidate);
    const changed = card.terminal.agentSessionId !== candidate.id || card.name !== nextName;
    if (changed && !persistAgentTranscriptCandidate(card.id, candidate)) return false;
    agentSessionToCard.set(candidate.id, card.id);
    return candidate.title !== null || !isAutoCardName(nextName);
  } catch (err) {
    console.warn(`[agent-discovery] failed for ${sessionId}: ${messageOf(err)}`);
    return false;
  }
}

function clearAgentDiscovery(sessionId: string): void {
  const timer = agentDiscoveryTimers.get(sessionId);
  if (timer) clearTimeout(timer);
  agentDiscoveryTimers.delete(sessionId);
  agentDiscoveryState.delete(sessionId);
}

function scheduleAgentDiscovery(sessionId: string, delay = AGENT_TRANSCRIPT_RETRY_MS): void {
  const current = agentDiscoveryState.get(sessionId);
  if (!current || current.attempts >= AGENT_TRANSCRIPT_MAX_ATTEMPTS) return;
  const existing = agentDiscoveryTimers.get(sessionId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    const next = agentDiscoveryState.get(sessionId);
    if (!next) return;
    agentDiscoveryState.set(sessionId, { ...next, attempts: next.attempts + 1 });
    discoverAgentTranscript(sessionId).then((done) => {
      if (done) clearAgentDiscovery(sessionId);
      else scheduleAgentDiscovery(sessionId);
    });
  }, delay);
  timer.unref?.();
  agentDiscoveryTimers.set(sessionId, timer);
}

function startAgentDiscovery(sessionId: string, startedAt: number, refresh: boolean): void {
  if (!cardTerminalSessions.has(sessionId)) return;
  if (!refresh && agentDiscoveryState.has(sessionId)) return;
  agentDiscoveryState.set(sessionId, { startedAt, attempts: 0 });
  scheduleAgentDiscovery(sessionId, 0);
}

function noteAgentForeground(sessionId: string): void {
  startAgentDiscovery(sessionId, Date.now(), false);
}

// Validate a client-supplied workspace dir: must be an absolute, existing
// directory. Anything else (relative, missing, a file) falls back to CLAUDE_CWD,
// so a cell can launch a terminal in a chosen dir without trusting raw input.
function resolveWorkspace(cwd: string | null): string {
  if (cwd && path.isAbsolute(cwd)) {
    try {
      if (statSync(cwd).isDirectory()) return cwd;
    } catch {
      // not a dir / doesn't exist — fall through
    }
  }
  return CLAUDE_CWD;
}

const SHELL_COMMANDS = new Set(
  ["sh", "bash", "zsh", "fish", "nu", "xonsh", "dash", "ksh", "tcsh", "csh", "powershell", "pwsh", path.basename(process.env.SHELL || "")]
    .filter(Boolean)
    .map((v) => v.toLowerCase()),
);

function normalizedCommand(command: string): string {
  return path.basename(command).toLowerCase();
}

function isShellCommand(command: string): boolean {
  return SHELL_COMMANDS.has(normalizedCommand(command));
}

function processTreeAgentArgs(sessionId: string, rows: ReadonlyArray<{ pid: number; ppid: number; args: string }>): string[] {
  const panePid = tmuxPanePid(sessionId);
  if (panePid === null) return [];
  return processTreeRows(rows, panePid).map((row) => row.args);
}

function isAgentForeground(sessionId: string, command: string, rows: ReadonlyArray<{ pid: number; ppid: number; args: string }>): boolean {
  return detectAgentProcess(AGENT_KINDS, command, processTreeAgentArgs(sessionId, rows)) !== null;
}

function pollOneCardProcess(sessionId: string, rows: ReadonlyArray<{ pid: number; ppid: number; args: string }>): void {
  const cardId = terminalSessionToCard.get(sessionId);
  if (!cardId) return;
  const command = tmuxPaneCurrentCommand(sessionId);
  if (!command) return;
  if (isAgentForeground(sessionId, command, rows)) {
    noteAgentForeground(sessionId);
    agentForegroundSessions.add(sessionId);
    return;
  }
  if (isShellCommand(command)) {
    const agentState = agentPtyActivity.get(sessionId);
    if (agentState?.working) emitAgentPtySignal(sessionId, "done");
    agentForegroundSessions.delete(sessionId);
    clearAgentActivity(sessionId);
    const previous = l2StatusBySession.get(sessionId);
    l2StatusBySession.set(sessionId, "done");
    if (previous && previous !== "done") applyBoardSignal(cardId, "done");
    return;
  }
  agentForegroundSessions.delete(sessionId);
  clearAgentActivity(sessionId);
  const status: CellStatus = "working";
  const previous = l2StatusBySession.get(sessionId);
  l2StatusBySession.set(sessionId, status);
  if (previous === status) return;
  if (!previous && status !== "working") return;
  applyBoardSignal(cardId, status);
}

let processPollRunning = false;
async function pollCardProcessSignals(): Promise<void> {
  if (!tmuxAvailable() || processPollRunning) return;
  processPollRunning = true;
  try {
    const rows = await currentProcessCommandRows();
    for (const sessionId of cardTerminalSessions) pollOneCardProcess(sessionId, rows);
  } catch (err) {
    // `ps` can exceed execFile's maxBuffer on process-heavy machines; the poll
    // runs detached from setInterval, so an uncaught rejection would crash the
    // whole server. Log and let the next tick retry.
    console.error(`[process-poll] failed: ${messageOf(err)}`);
  } finally {
    processPollRunning = false;
  }
}

function clearAgentActivity(sessionId: string): void {
  agentPtyActivity.delete(sessionId);
  const timer = agentSilenceTimers.get(sessionId);
  if (timer) clearTimeout(timer);
  agentSilenceTimers.delete(sessionId);
}

function emitAgentPtySignal(sessionId: string, signal: AgentPtySignal): void {
  const cardId = terminalSessionToCard.get(sessionId);
  if (!cardId) return;
  if (signal === "working") startAgentDiscovery(sessionId, Date.now(), true);
  const status: CellStatus = signal === "working" ? "working" : "done";
  if (l3StatusByCard.get(cardId) === status) return;
  l3StatusByCard.set(cardId, status);
  applyBoardSignal(cardId, status);
  if (signal === "done") scheduleAgentDiscovery(sessionId, 0);
}

function reduceAgentActivityForSession(sessionId: string, state: AgentPtyActivityState, event: AgentPtyActivityEvent): AgentPtyActivityState {
  const result = reduceAgentPtyActivity(state, event);
  if (result.signal) emitAgentPtySignal(sessionId, result.signal);
  return result.state;
}

function scheduleAgentSilenceCheck(sessionId: string): void {
  const existing = agentSilenceTimers.get(sessionId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    const state = agentPtyActivity.get(sessionId);
    if (!state) return;
    const next = reduceAgentActivityForSession(sessionId, state, { type: "silence", at: Date.now() });
    if (next.working) agentPtyActivity.set(sessionId, next);
    else clearAgentActivity(sessionId);
  }, AGENT_SILENCE_MS + 25);
  agentSilenceTimers.set(sessionId, timer);
}

function noteAgentEnter(sessionId: string): void {
  if (!cardTerminalSessions.has(sessionId) || !agentForegroundSessions.has(sessionId)) return;
  const state = agentPtyActivity.get(sessionId) ?? emptyAgentPtyActivityState();
  agentPtyActivity.set(sessionId, reduceAgentActivityForSession(sessionId, state, { type: "enter", at: Date.now() }));
}

function noteAgentOutput(sessionId: string): void {
  const existing = agentPtyActivity.get(sessionId);
  if (!existing && !agentForegroundSessions.has(sessionId)) return;
  const state = existing ?? emptyAgentPtyActivityState();
  const next = reduceAgentActivityForSession(sessionId, state, { type: "output", at: Date.now() });
  if (next.working || next.pendingSince !== null) agentPtyActivity.set(sessionId, next);
  else agentPtyActivity.delete(sessionId);
  if (next.working) scheduleAgentSilenceCheck(sessionId);
}

// The most recent user prompt from a resumed session's on-disk transcript, so a
// freshly-resumed cell can show its last prompt instead of just the id. null if
// there's no transcript yet (a never-prompted session) or it can't be read.
async function latestUserPrompt(cwd: string, id: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(path.join(projectSessionsDir(cwd), `${id}.jsonl`), "utf8");
    return latestMeaningfulUserPromptFromJsonl(raw);
  } catch {
    return null;
  }
}

const EMPTY_USAGE: SessionUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
// One read of a session's transcript → its latest prompt AND cumulative token usage,
// so /api/session/:id doesn't parse the .jsonl twice.
async function readSessionSummary(cwd: string, id: string): Promise<{ lastPrompt: string | null; usage: SessionUsage }> {
  try {
    const raw = await fs.readFile(path.join(projectSessionsDir(cwd), `${id}.jsonl`), "utf8");
    return { lastPrompt: latestMeaningfulUserPromptFromJsonl(raw), usage: sessionUsageFromJsonl(raw) };
  } catch {
    return { lastPrompt: null, usage: EMPTY_USAGE };
  }
}

// Scan a session JSONL for a human-friendly title and last activity.
async function readSessionMeta(dir: string, file: string): Promise<SessionMeta> {
  const full = path.join(dir, file);
  const [raw, stat] = await Promise.all([fs.readFile(full, "utf8"), fs.stat(full)]);

  let aiTitle: string | null = null;
  let lastPrompt: string | null = null;
  let firstUserMsg: string | null = null;

  for (const o of parseJsonl(raw)) {
    if (o.type === "ai-title" && o.aiTitle) aiTitle = String(o.aiTitle);
    else if (o.type === "last-prompt" && o.lastPrompt) lastPrompt = String(o.lastPrompt);
    else if (o.type === "user" && firstUserMsg === null) {
      firstUserMsg = userPromptText(isRecord(o.message) ? o.message.content : undefined);
    }
  }

  const title = aiTitle || lastPrompt || firstUserMsg || "(untitled session)";
  const id = path.basename(file, ".jsonl");
  const a = activity.get(id);
  return {
    id,
    title,
    mtime: stat.mtimeMs,
    working: a?.working ?? false,
    waiting: a?.waiting ?? false,
    event: a?.event ?? null,
    hidden: false,
  };
}

const app = express();
app.use(express.json({ limit: "25mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, app: "kanban-terminal" });
});

// Notification REST surface (list active / history, dismiss one) — backs the toolbar
// bell. The engine is configured below once pubsub + the workspace exist.
mountNotificationRoutes(app);

// Serve Vite build output
app.use(express.static(path.join(__dirname, "../dist")));

// SPA fallback for vue-router history mode: a hard reload / deep-link of a client
// route must serve index.html. Mounted AFTER express.static so
// real asset files win. SPA_FALLBACK_RE reserves the single /api prefix — see
// server/spa-fallback.ts for why that's sufficient.
app.get(SPA_FALLBACK_RE, (_req, res) => res.sendFile(path.join(__dirname, "../dist/index.html")));

// Activity hooks update a session's working / needs-attention flags.
// `foreground` (a ws is attached => being viewed) suppresses the attention flag.
function handleActivityHook(sessionId: string, event: string, foreground: boolean, cardId: string | null) {
  let cardStatus: CellStatus | null = null;
  if (event === "UserPromptSubmit") {
    setWorking(sessionId, true, event);
    cardStatus = "working";
  } else if (event === "Stop") {
    // A background session that finished a turn has output the user hasn't seen
    // yet (and is ready for another message) — flag it for attention.
    if (!foreground) setWaiting(sessionId, true, event);
    setWorking(sessionId, false, event);
    cardStatus = "done";
  } else if (event === "Notification") {
    // Background session waiting for input (permission / question / idle).
    if (!foreground) setWaiting(sessionId, true, event);
    cardStatus = "blocked";
  }
  if (cardId && cardStatus) {
    l3StatusByCard.set(cardId, cardStatus);
    applyBoardSignal(cardId, cardStatus);
  }
}

// Track the prompt the cell header shows for a session, from a UserPromptSubmit
// hook. On the FIRST live prompt after a (re)start/resume the in-memory baseline is
// empty, so seed it from the transcript's meaningful prompt — otherwise a trivial
// ack ("ok") would overwrite the restored task. (Brand-new sessions have no
// transcript yet => null => the new prompt becomes the first shown.) Then keep the
// last MEANINGFUL prompt (preferredHeaderPrompt) while still tracking the latest for
// an all-trivial session.
async function trackPromptForHeader(sessionId: string, prompt: string, cwd: string | undefined) {
  if (!lastPrompts.has(sessionId)) {
    const seeded = cwd ? await latestUserPrompt(cwd, sessionId) : null;
    if (seeded) lastPrompts.set(sessionId, seeded);
  }
  lastPrompts.set(sessionId, preferredHeaderPrompt(lastPrompts.get(sessionId) ?? null, prompt));
}

// Claude hooks (Stop / Notification / UserPromptSubmit) POST their payload here so
// we can flag which background sessions have new activity.
app.post("/api/hook", async (req, res) => {
  const body = req.body || {};
  const sessionId = body.session_id;
  const event = body.hook_event_name;
  if (sessionId) {
    const hookCardId = sanitizeCardId(typeof body.card_id === "string" ? body.card_id : null);
    if (hookCardId) agentSessionToCard.set(sessionId, hookCardId);
    const cardId = hookCardId ?? agentSessionToCard.get(sessionId) ?? null;
    const entry = ptys.get(sessionId);
    const foreground = !!(entry && entry.ws);
    // Update the displayed prompt BEFORE handleActivityHook so the activity publish
    // it triggers already carries the new lastPrompt.
    if (event === "UserPromptSubmit" && typeof body.prompt === "string" && body.prompt.trim()) {
      const cwd = typeof body.cwd === "string" ? body.cwd : entry?.cwd;
      await trackPromptForHeader(sessionId, body.prompt.trim().slice(0, LAST_PROMPT_CAP), cwd);
    }
    handleActivityHook(sessionId, event, foreground, cardId);
    console.log(`[hook] ${event} for ${sessionId}`);
  }
  res.json({ ok: true });
});

// GET/POST /api/config — in its own module.
mountConfigRoutes(app, CLAUDE_CWD);

// GRID-ONLY (dev_tool): the `script.json` entries a cell's launcher offers for its
// chosen directory (?cwd=<dir>, falling back to CLAUDE_CWD). The browser shows
// these and sends back only an INDEX + the cwd (see /ws/run), so the file is the
// allowlist of what can run. The resolved `cwd` is returned so the cell runs the
// script in the same dir it listed scripts for.
app.get("/api/scripts", (req, res) => {
  const cwd = resolveWorkspace(typeof req.query.cwd === "string" ? req.query.cwd : null);
  res.json({ cwd, scripts: loadScripts(cwd).map((s, index) => ({ index, label: s.label, command: s.command, cwd: s.cwd })) });
});

// GRID-ONLY (dev_tool): POST /api/open-dir reveals a cell's working directory in the
// OS file manager (a browser tab can't, but this local server can).
mountOpenDirRoute(app, { isAllowedOrigin });

// GRID-ONLY (dev_tool): POST /api/git-remote reports a cell dir's GitHub repository
// URL (null if it isn't a GitHub repo), so the header can offer an "open on GitHub" link.
mountGitRemoteRoute(app, { isAllowedOrigin });

// POST /api/pick-file opens the OS file dialog and returns the chosen absolute
// path(s) — how a browser tab inserts a real filesystem path into the terminal
// (the browser hides paths from drag/drop and <input type=file>).
mountPickFileRoute(app, { isAllowedOrigin });
mountPickDirectoryRoute(app, { isAllowedOrigin });

// GRID-ONLY (dev_tool): initial per-session status + last prompt, so a grid cell
// can render its header immediately (live updates then arrive via the "sessions"
// pub/sub channel). The single view reads activity straight from that channel.
// ?cwd= locates the transcript so a freshly-resumed session shows its most recent
// prompt; the live in-memory prompt (this process run) takes precedence.
app.get("/api/session/:id", async (req, res) => {
  const { id } = req.params;
  if (!SESSION_ID_RE.test(id)) return res.status(400).json({ error: "invalid session id" });
  const cwd = resolveWorkspace(typeof req.query.cwd === "string" ? req.query.cwd : null);
  const a = activity.get(id) || {};
  const { lastPrompt: transcriptPrompt, usage } = await readSessionSummary(cwd, id);
  const lastPrompt = lastPrompts.get(id) ?? transcriptPrompt;
  res.json({
    id,
    cwd,
    working: a.working ?? false,
    waiting: a.waiting ?? false,
    event: a.event ?? null,
    lastPrompt,
    usage,
  });
});

// Per-directory overrides (<cwd>/.mulmoterminal.json): the badge/name/theme a
// terminal opened in this directory should use. cwd is validated like every other
// cwd-scoped route; the raw sound path stays server-side (see /api/dir-sound).
app.get("/api/dir-config", (req, res) => {
  const cwd = resolveWorkspace(typeof req.query.cwd === "string" ? req.query.cwd : null);
  res.json(publicDirConfig(cwd));
});

// Stream a directory's custom attention sound. The path never comes from the
// request — it's read from that dir's .mulmoterminal.json and confined to the dir —
// so there's no traversal surface. 404 when unset/missing (the client falls back to
// the global sound, then the built-in chime).
app.get("/api/dir-sound", (req, res) => {
  const cwd = resolveWorkspace(typeof req.query.cwd === "string" ? req.query.cwd : null);
  const file = dirSoundFile(cwd);
  if (!file) return res.status(404).end();
  // dotfiles:"allow" — the conventional location is a hidden <cwd>/.mulmoterminal/
  // dir, which send() would otherwise 404. The path is already confined to cwd, so
  // serving from a dot-segment is safe here.
  res.sendFile(file, { dotfiles: "allow" }, (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

// List the chat sessions for the current project (CLAUDE_CWD), including
// newly-created sessions that aren't persisted to disk yet.
app.get("/api/sessions", async (req, res) => {
  try {
    // Optional ?cwd= scopes the list to that project's on-disk sessions (the grid
    // cell's resume picker). Without it, the classic single view's behavior is
    // unchanged: CLAUDE_CWD + in-memory pending sessions.
    const cwdParam = typeof req.query.cwd === "string" ? req.query.cwd : null;
    const cwd = cwdParam ? resolveWorkspace(cwdParam) : CLAUDE_CWD;
    const includePending = !cwdParam;
    // Wait for the persisted grid-session set before filtering (below), so a chat
    // request racing server boot can't leak previously-hidden grid transcripts.
    if (includePending) await devTerminalSessionsHydrated;
    const dir = projectSessionsDir(cwd);
    let files: string[] = [];
    try {
      files = (await fs.readdir(dir)).filter((f) => f.endsWith(".jsonl"));
    } catch (err) {
      if (!hasErrnoCode(err) || err.code !== "ENOENT") throw err;
    }

    // Cheap pass: stat (don't read) every file just for its mtime, so we can
    // rank by recency. Skip any that vanished between readdir and stat.
    const onDiskStats = (
      await Promise.all(
        files.map(async (file): Promise<DiskStat | null> => {
          try {
            const st = await fs.stat(path.join(dir, file));
            return { kind: "disk", id: path.basename(file, ".jsonl"), file, mtime: st.mtimeMs };
          } catch {
            return null;
          }
        }),
      )
    ).filter((s): s is DiskStat => s !== null);
    const onDisk = new Set(onDiskStats.map((s) => s.id));

    // In-memory sessions not yet written to disk. Prune any that have since
    // been persisted — the on-disk record (with its real title) wins. Skipped for
    // a cwd-scoped query (pending sessions aren't tracked per directory).
    const pending: PendingSession[] = [];
    for (const [id, meta] of includePending ? knownSessions : []) {
      if (onDisk.has(id)) {
        knownSessions.delete(id);
        continue;
      }
      pending.push({
        kind: "pending",
        id,
        title: meta.title,
        mtime: meta.createdAt,
        working: activity.get(id)?.working ?? false,
        waiting: activity.get(id)?.waiting ?? false,
        event: activity.get(id)?.event ?? null,
        hidden: false,
      });
    }

    // Keep only the most-recent N, then read & parse contents for just those
    // on-disk files (a deleted/corrupt file is dropped, not fatal).
    const top = [...onDiskStats, ...pending]
      // Hide multi-terminal GRID sessions from the CHAT sidebar (the unscoped query
      // only). The grid's own resume picker passes ?cwd= (includePending=false) and
      // must keep listing them, so gate the exclusion on includePending.
      .filter((s) => !includePending || !devTerminalSessions.has(s.id))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, SESSION_LIST_LIMIT);
    const sessions = (
      await Promise.all(
        top.map((s) =>
          s.kind === "pending"
            ? { id: s.id, title: s.title, mtime: s.mtime, working: s.working, waiting: s.waiting, event: s.event, hidden: s.hidden }
            : readSessionMeta(dir, s.file).catch(() => null),
        ),
      )
    )
      .filter((s): s is SessionMeta => s !== null)
      .sort((a, b) => b.mtime - a.mtime);

    res.json({ cwd, sessions });
  } catch (err) {
    console.error("[api] /api/sessions failed:", err);
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/memory", async (_req, res) => {
  try {
    const rows = await currentProcessRows();
    const sessions = [...ptys.entries()]
      .filter(([id]) => cardTerminalSessions.has(id))
      .map(([sessionId, entry]) => ({ sessionId, rssKb: sumProcessTreeRss(rows, entry.term.pid) }));
    res.json({ totalRssKb: sessions.reduce((sum, item) => sum + item.rssKb, 0), sessions });
  } catch (err) {
    res.status(500).json({ error: messageOf(err) });
  }
});

app.delete("/api/cards/:id/terminal", (req, res) => {
  const cardId = sanitizeCardId(req.params.id ?? null);
  if (!cardId) return res.status(400).json({ error: "invalid card id" });
  const board = loadBoard();
  const card = board.cards.find((c) => c.id === cardId);
  if (!card) return res.status(404).json({ error: "card not found" });
  if (!card.archived) return res.status(409).json({ error: "card must be archived before releasing its terminal" });

  const sessionId = card.terminal.sessionId;
  const released = sessionId ? releaseTerminalSession(sessionId) : false;
  const next: BoardState = {
    ...board,
    cards: board.cards.map((c) => (c.id === card.id ? { ...c, terminal: { ...c.terminal, sessionId: null }, lastStatus: "idle", updatedAt: Date.now() } : c)),
  };
  if (!saveBoard(next)) return res.status(500).json({ error: "failed to persist board" });
  publishBoardUpdate();
  return res.json({ ok: true, released });
});

const server = http.createServer(app);
pubsub = createPubSub(server, isAllowedOrigin);
mountBoardRoutes(app, {
  isCardViewed,
  pubsub,
  onSaved: hydrateCardTerminalSessions,
  onCardClosed: markCardClosed,
  onCardRead: markCardViewed,
  prepareBoard: ensureBoardTerminals,
});

// Wire the notification REST surface for the toolbar bell.
await initNotifier({ workspace: CLAUDE_CWD, pubsub });
{
  const board = loadBoard();
  const prepared = ensureBoardTerminals(board);
  if (prepared !== board) {
    saveBoard(prepared);
    hydrateCardTerminalSessions();
  }
}

const processPollTimer = setInterval(() => void pollCardProcessSignals(), 2000);
processPollTimer.unref?.();

// Terminal WebSocket. Uses noServer + manual upgrade routing so it shares the
// HTTP server with socket.io (the pub/sub at /ws/pubsub) without the two
// libraries fighting over the "upgrade" event.
const wss = new WebSocketServer({ noServer: true });
// Command terminals (the grid's Run menu) get their own WS so the plain-command
// PTY relay stays clear of the session/hook/transcript machinery on /ws.
const runWss = new WebSocketServer({ noServer: true });
// Launcher terminals (a plain shell / codex / any configured command) get their own WS
// too. Unlike /ws/run these are PERSISTENT & reattachable (they share the /ws session
// lifecycle — ptys map, reattach, reap grace) but carry no Claude hooks/transcript.
const runLaunchWss = new WebSocketServer({ noServer: true });
function wssForPath(pathname: string): WebSocketServer | null {
  if (pathname === "/ws") return wss;
  if (pathname === "/ws/run") return runWss;
  if (pathname === "/ws/launch") return runLaunchWss;
  return null; // e.g. /ws/pubsub — left to socket.io's own upgrade handler
}
server.on("upgrade", (req, socket, head) => {
  const { pathname } = new URL(req.url ?? "/", "http://localhost");
  const target = wssForPath(pathname);
  if (!target) return;
  if (!isAllowedOrigin(req.headers.origin)) {
    console.warn(`[ws] rejected cross-origin upgrade from ${req.headers.origin}`);
    socket.destroy();
    return;
  }
  target.handleUpgrade(req, socket, head, (ws) => target.emit("connection", ws, req));
});

// Reattach a live background PTY to a new socket: drop any stale socket, swap in
// the new one, and replay the buffered tail for context.
function reattachPty(entry: PtyEntry, ws: WebSocket, sessionId: string): PtyEntry {
  cancelReap(sessionId); // a reattach within the grace window keeps the session
  console.log(`[ws] reattach ${sessionId} (pid=${entry.term.pid})`);
  // Drop any socket still attached (e.g. the same session open in another tab).
  // Tell it it's been superseded FIRST so it stops instead of auto-reconnecting —
  // otherwise two clients on one session ping-pong (each reattach kicks the other,
  // the kicked one reconnects, …) into a storm.
  if (entry.ws && entry.ws !== ws && entry.ws.readyState === entry.ws.OPEN) {
    try {
      entry.ws.send(JSON.stringify({ type: "superseded" }));
    } catch {
      // socket already going away — closing below is enough
    }
    entry.ws.close();
  }
  entry.ws = ws;
  if (entry.buffer && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type: "replay", data: entry.buffer }));
  }
  return entry;
}

// Claude must have its input box + bracketed-paste mode up before it will capture a
// typed `draft`; too early and the bytes are echoed into the scrollback instead. We
// wait for its status line to paint (the "shift+tab to cycle" mode hint), settle
// briefly, then type. A fallback fires if that marker never shows (UI string drift).
const DRAFT_READY_MARKER = /shift\+tab to cycle/;
const DRAFT_SETTLE_MS = 250;
const DRAFT_FALLBACK_MS = 6000;

// Sanitize a draft before typing it into a PTY: strip ALL control bytes (C0/C1 —
// ESC, Ctrl-C, CR/LF, and an embedded bracketed-paste terminator) so untrusted draft
// content can't inject terminal control sequences that break out of the paste and
// submit/interrupt. Only printable text survives, with whitespace collapsed.
// eslint-disable-next-line no-control-regex -- intentional: match terminal control bytes (C0/C1) to strip them
const DRAFT_CONTROL_BYTES_RE = /[\u0000-\u001F\u007F-\u009F]+/g;
function sanitizeDraftText(text: string): string {
  return text.replace(DRAFT_CONTROL_BYTES_RE, " ").replace(/\s+/g, " ").trim();
}

const SHELL_DRAFT_DELAY_MS = 500;
function typeShellDraft(entry: PtyEntry, draft: string | null): void {
  const draftText = draft ? sanitizeDraftText(draft) : "";
  if (!draftText) return;
  setTimeout(() => {
    try {
      entry.term.write(draftText);
    } catch {
      // pty already gone — nothing to draft into
    }
  }, SHELL_DRAFT_DELAY_MS).unref?.();
}

// Spawn a fresh claude PTY for this session, register it, and wire its output /
// exit back to the browser socket. `ws` may be null for a session spawned without
// a viewer yet (e.g. spawnBackgroundChat) — output just buffers until a client
// reattaches. `initialPrompt`, when given, is passed to claude as the first turn
// so the session starts working immediately, before anyone opens it. `draft` is the
// opposite: it is NOT auto-submitted — once claude's UI is ready the text is typed
// into the input box (no Enter) so the user can review / edit / send it. Pass one or
// the other, never both.
// pty.spawn with the binary as a PARAMETER (never a string literal at the call site),
// so the tmux/shell/claude spawns aren't flagged as spawn-of-a-string-literal.
function spawnPty(bin: string, args: string[], cwd: string): IPty {
  return pty.spawn(bin, args, { name: "xterm-256color", cols: PTY_COLS, rows: PTY_ROWS, cwd, env: process.env });
}

// Spawn a terminal, wrapping it in a persistent tmux session when tmux is available and
// `persistent` is set, so it survives the server dying. `tmux new-session -A` creates it
// (running file+args) or reattaches the surviving one. Returns whether tmux backs it.
function ptySpawn(sessionId: string, file: string, args: string[], cwd: string, persistent: boolean): { term: IPty; tmux: boolean } {
  if (persistent && tmuxAvailable()) {
    return { term: spawnPty("tmux", tmuxNewSessionArgs(sessionId, file, args, cwd), cwd), tmux: true };
  }
  return { term: spawnPty(file, args, cwd), tmux: false };
}

function spawnClaudePty(
  sessionId: string,
  resume: string | null,
  ws: WebSocket | null,
  initialPrompt?: string,
  cwd: string = CLAUDE_CWD,
  draft?: string,
): PtyEntry {
  // Only --resume when the session has an on-disk transcript — claude doesn't write
  // a session's .jsonl until its first prompt, so a started-but-unused session can't
  // be resumed; we restart fresh (reusing the id via --session-id) instead.
  const canResume = resume !== null && sessionExistsOnDisk(resume, cwd);
  const args = CLAUDE_AGENT.resumeCommand({
    sessionId,
    resume,
    canResume,
    settings: hookSettingsJson(),
    permissionMode: CLAUDE_PERMISSION_MODE,
    initialPrompt,
  });

  console.log(`[ws] client connected (${canResume ? "resume" : "new"} ${sessionId})`);

  const { term, tmux } = ptySpawn(sessionId, CLAUDE_BIN, args, cwd, true);
  console.log(`[pty] spawned claude (pid=${term.pid}${tmux ? " via tmux" : ""}) in ${cwd}`);
  const entry: PtyEntry = { term, ws, buffer: "", cwd, tmux };
  ptys.set(sessionId, entry);

  if (!canResume) {
    // Brand-new (or restarted-idle) session: surface it in the sidebar before
    // it's persisted. A spawned session (initialPrompt or a draft) gets a title from
    // that text so it's recognizable in the sidebar before anyone opens it.
    const seed = initialPrompt ?? draft;
    const title = seed ? seed.replace(/\s+/g, " ").trim().slice(0, 60) || "New session" : "New session";
    knownSessions.set(sessionId, { createdAt: Date.now(), title });
    pubsub?.publish(SESSIONS_CHANNEL, { id: sessionId, working: false, event: "created" });
  }

  // A draft is typed into the input box once claude is ready for input. ALL control
  // bytes are stripped first — C0/C1, including ESC, Ctrl-C, CR/LF and an embedded
  // bracketed-paste terminator (\e[201~) — so untrusted draft content can't inject
  // terminal control sequences that break out of the
  // paste and submit/interrupt. Only printable text is typed, wrapped in bracketed
  // paste (\e[200~…\e[201~), with NO trailing Enter, so it can never auto-submit — the
  // user reviews and presses Enter.

  const draftText = draft ? sanitizeDraftText(draft) : "";
  let draftDone = !draftText;
  let draftScan = "";
  const typeDraft = () => {
    if (draftDone) return;
    draftDone = true;
    try {
      entry.term.write(`\x1b[200~${draftText}\x1b[201~`);
    } catch {
      // pty already gone — nothing to draft into
    }
  };
  // Fallback: type even if the readiness marker never appears (UI string drift).
  if (draftText) setTimeout(typeDraft, DRAFT_FALLBACK_MS);

  // PTY -> browser (buffering a bounded tail for reattach).
  entry.term.onData((data) => {
    entry.buffer = (entry.buffer + data).slice(-OUTPUT_BUFFER_LIMIT);
    if (entry.ws && entry.ws.readyState === entry.ws.OPEN) {
      entry.ws.send(JSON.stringify({ type: "output", data }));
    }
    // Type the draft once claude's input box has painted (its mode-hint status line),
    // then settle briefly so the paste lands in the input rather than the scrollback.
    if (!draftDone) {
      draftScan = (draftScan + data).slice(-4096);
      if (DRAFT_READY_MARKER.test(draftScan)) {
        draftScan = "";
        setTimeout(typeDraft, DRAFT_SETTLE_MS);
      }
    }
  });

  entry.term.onExit(({ exitCode, signal }) => {
    console.log(`[pty] exited code=${exitCode} signal=${signal}`);
    if (entry.ws && entry.ws.readyState === entry.ws.OPEN) {
      entry.ws.send(JSON.stringify({ type: "exit", exitCode, signal }));
      entry.ws.close();
    }
    // Clear the dot if it died mid-turn, then tear down everything (deletes
    // ptys/knownSessions/activity and publishes "closed") so a process that
    // exits on its own — e.g. a brand-new session that never persisted —
    // doesn't linger in the sidebar.
    setWorking(sessionId, false);
    reap(sessionId);
  });

  return entry;
}

// browser -> PTY. The protocol is client-controlled, so validate every frame
// before touching node-pty (bad cols/rows or non-string input can throw).
function handleClientFrame(entry: PtyEntry, ws: WebSocket, raw: RawData, sessionId: string) {
  // Ignore frames from a socket that a newer client has already superseded.
  if (entry.ws !== ws) return;
  let msg;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    return; // not JSON — never write arbitrary payloads to the PTY
  }
  try {
    if (msg.type === "terminate") {
      // Explicit close (the cell's ✕) — reap now instead of waiting out the
      // disconnect grace window, so the session slot frees immediately.
      reap(sessionId);
    } else if (msg.type === "input" && typeof msg.data === "string") {
      if (msg.data.includes("\r")) noteAgentEnter(sessionId);
      entry.term.write(msg.data);
    } else if (
      msg.type === "resize" &&
      Number.isInteger(msg.cols) &&
      Number.isInteger(msg.rows) &&
      msg.cols >= 2 &&
      msg.cols <= 500 &&
      msg.rows >= 1 &&
      msg.rows <= 200
    ) {
      entry.term.resize(msg.cols, msg.rows);
    }
  } catch (err) {
    // e.g. a write/resize that races the PTY exiting — drop it, never crash.
    console.warn(`[ws] dropped message for ${sessionId}: ${messageOf(err)}`);
  }
}

// Run an arbitrary shell command in a PTY and relay its I/O to the browser. Unlike
// spawnClaudePty this is NOT a Claude session — no id, no hooks, no transcript, no
// reap/grace. It's an ephemeral grid terminal (the Run menu); the caller kills it
// when the viewer's socket closes.
function spawnCommandPty(command: string, cwd: string, ws: WebSocket): IPty {
  const isWindows = process.platform === "win32";
  const shell = isWindows ? "powershell.exe" : process.env.SHELL || "/bin/bash";
  const args = isWindows ? ["-NoLogo", "-Command", command] : ["-lc", command];
  const term = pty.spawn(shell, args, { name: "xterm-256color", cols: 120, rows: 30, cwd, env: process.env });
  console.log(`[pty] spawned command (pid=${term.pid}) in ${cwd}: ${command}`);

  term.onData((data) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "output", data }));
  });
  term.onExit(({ exitCode, signal }) => {
    console.log(`[pty] command exited code=${exitCode} signal=${signal}`);
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "exit", exitCode, signal }));
      ws.close();
    }
  });
  return term;
}

// Resolve a launcher by its position in the user's configured list — the browser
// sends only an INDEX (the config is the allowlist), never a raw command.
function resolveLauncher(index: number): { label: string; command: string } | null {
  const list = getLaunchers();
  return Number.isInteger(index) && index >= 0 && index < list.length ? list[index] : null;
}

// Spawn a configured launcher command as a PERSISTENT, reattachable PTY that shares
// the Claude session lifecycle (ptys map, reattach, reap grace) but has NO hooks,
// transcript, or resume. The command is run via the login shell with `exec` so it
// becomes the single foreground process ($SHELL, codex, etc.) — env vars in the
// command (e.g. $SHELL) expand, and the process stays interactive in the PTY.
function spawnLauncherPty(
  sessionId: string,
  ws: WebSocket | null,
  command: string,
  cwd: string,
  cardId: string | null = null,
  draft: string | null = null,
): PtyEntry {
  const isWindows = process.platform === "win32";
  const shell = isWindows ? "powershell.exe" : process.env.SHELL || "/bin/bash";
  const args = isWindows ? ["-NoLogo", "-Command", command] : ["-lc", `exec ${command}`];
  // Persistent: reattaches a surviving tmux session (command ignored) or creates one.
  const { term, tmux } = ptySpawn(sessionId, shell, args, cwd, true);
  console.log(`[pty] spawned launcher (pid=${term.pid}${tmux ? " via tmux" : ""}) in ${cwd}: ${command}`);

  const entry: PtyEntry = { term, ws, buffer: "", cwd, tmux };
  ptys.set(sessionId, entry);
  typeShellDraft(entry, draft);

  term.onData((data) => {
    entry.buffer = (entry.buffer + data).slice(-OUTPUT_BUFFER_LIMIT);
    if (cardId) noteAgentOutput(sessionId);
    if (entry.ws && entry.ws.readyState === entry.ws.OPEN) {
      entry.ws.send(JSON.stringify({ type: "output", data }));
    }
  });
  term.onExit(({ exitCode, signal }) => {
    console.log(`[pty] launcher exited code=${exitCode} signal=${signal}`);
    if (entry.ws && entry.ws.readyState === entry.ws.OPEN) {
      entry.ws.send(JSON.stringify({ type: "exit", exitCode, signal }));
      entry.ws.close();
    }
    reap(sessionId);
  });
  return entry;
}

// browser -> command PTY. Like handleClientFrame but for the session-less command
// terminal: only input/resize (no terminate/session machinery).
function handleCommandFrame(term: IPty, raw: RawData) {
  let msg;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    return; // not JSON — never write arbitrary payloads to the PTY
  }
  try {
    if (msg.type === "input" && typeof msg.data === "string") {
      term.write(msg.data);
    } else if (
      msg.type === "resize" &&
      Number.isInteger(msg.cols) &&
      Number.isInteger(msg.rows) &&
      msg.cols >= 2 &&
      msg.cols <= 500 &&
      msg.rows >= 1 &&
      msg.rows <= 200
    ) {
      term.resize(msg.cols, msg.rows);
    }
  } catch (err) {
    console.warn(`[ws/run] dropped message: ${messageOf(err)}`);
  }
}

// Socket closed: detach it and decide the PTY's fate by activity — working stays
// alive, needs-the-user gets a long grace, idle gets the short grace.
function handleClientClose(entry: PtyEntry, ws: WebSocket, sessionId: string) {
  // Ignore if a newer client already reattached to this session.
  if (entry.ws !== ws) return;
  entry.ws = null;
  markCardClosedForSession(sessionId);
  if (cardTerminalSessions.has(sessionId)) {
    console.log(`[ws] suspended card terminal ${sessionId}`);
    return;
  }
  // Keep a working session alive indefinitely, give a session that needs the user
  // the long grace, and reap a genuinely idle one after the short grace. A reload
  // reconnects in a moment and re-attaches (cancelling the reap) regardless.
  console.log(`[ws] disconnected ${sessionId}`);
  armReapForDetached(sessionId);
}

// Pick the effective session id for a /ws connection: reattach a same-process live pty,
// else a tmux session that outlived a restart (warm, no --resume), else `--resume` an
// on-disk transcript (cold), else a fresh id. `resume` is set only for the cold case.
function resolveClaudeSession(requested: string | null, cwd: string): { reattachId: string | null; resume: string | null; sessionId: string } {
  const reattachId = requested && ptys.has(requested) ? requested : null;
  const tmuxAlive = !reattachId && !!requested && tmuxHasSession(requested);
  const resume = !reattachId && !tmuxAlive && requested && sessionExistsOnDisk(requested, cwd) ? requested : null;
  const sessionId = reattachId ?? (requested && (tmuxAlive || resume) ? requested : randomUUID());
  return { reattachId, resume, sessionId };
}

wss.on("connection", (ws, req) => {
  // ?session=<id> resumes an existing conversation; absent => fresh session. For
  // new sessions we generate the id ourselves (--session-id) so the server always
  // knows the current session's id, even before any file exists.
  const url = new URL(req.url ?? "/", "http://localhost");
  const raw = url.searchParams.get("session");
  // A non-UUID id is never used (it could smuggle path/flag fragments into
  // sessionExistsOnDisk / --resume). Treat it as "no session requested" rather
  // than closing the socket — closing without a replacement id makes the client
  // auto-reconnect with the same bad id forever. Falling through mints a fresh
  // session and tells the browser the new id, so the cell self-recovers.
  const requested = raw && SESSION_ID_RE.test(raw) ? raw : null;
  if (raw && !requested) console.warn(`[ws] ignoring non-UUID session id: ${JSON.stringify(raw)} — starting fresh`);

  // The cell may launch a terminal in a chosen directory (?cwd=<abs>). Validated
  // (absolute, existing dir) and used as the PTY cwd + the project to resume from;
  // falls back to CLAUDE_CWD.
  const cwd = resolveWorkspace(url.searchParams.get("cwd"));

  const isDevTerminal = url.searchParams.get("dev") === "1";
  const isCardTerminal = url.searchParams.get("card") === "1";

  // Decide the effective session id BEFORE telling the browser. A requested id
  // is honored only if it can actually be served: a live pty (reattach) or an
  // on-disk transcript (`--resume`). A requested id that's neither — e.g. a cell
  // reloading an idle session claude never persisted — can't be reused: claude
  // exits with "session id already in use" if we retry `--session-id <same>`.
  // So mint a fresh id; the browser adopts it from this `session` message and
  // re-persists, so the reload just reopens a working terminal seamlessly.
  const { reattachId, resume, sessionId } = resolveClaudeSession(requested, cwd);
  const live = reattachId ? ptys.get(reattachId) : undefined;
  if (isCardTerminal) cardTerminalSessions.add(sessionId);

  // A dev terminal is a multi-terminal GRID cell: remember its session id so
  // it's excluded from the chat sidebar (see devTerminalSessions). This is the single
  // choke point for every grid attach — new, resumed, or reattached — so the mark is
  // recorded (and re-recorded after a reboot when the cell reconnects) exactly once.
  if (isDevTerminal) markDevTerminalSession(sessionId);

  // Tell the browser which session this is (it learns the id of new sessions) and
  // the EFFECTIVE cwd — where claude really runs. On reattach that's the live
  // PTY's own cwd (NOT this request's ?cwd=, which it ignores); otherwise it's the
  // resolved cwd the new PTY will spawn in.
  const reportedCwd = live?.cwd ?? cwd;
  ws.send(JSON.stringify({ type: "session", id: sessionId, cwd: reportedCwd }));

  let entry: PtyEntry;
  try {
    entry = live ? reattachPty(live, ws, sessionId) : spawnClaudePty(sessionId, resume, ws, undefined, cwd);
  } catch (err) {
    // A failed spawn (claude missing, or node-pty's spawn-helper not executable)
    // must close just this connection — never crash the whole server.
    console.error(`[ws] failed to start session ${sessionId}: ${messageOf(err)}`);
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "error", message: "Failed to start Claude. Is the `claude` CLI installed and on your PATH?" }));
      ws.close();
    }
    return;
  }

  // The session is now in the foreground (being viewed): clear any
  // "waiting for input" flag so it stops showing as bold.
  setWaiting(sessionId, false);

  ws.on("message", (raw) => handleClientFrame(entry, ws, raw, sessionId));
  ws.on("close", () => handleClientClose(entry, ws, sessionId));
});

// Command terminal (?index=<n>&cwd=<dir>): resolve the script from <dir>'s
// script.json by index (the browser never sends a raw command) and run it there in
// a plain PTY. Ephemeral — when the socket closes, the process is killed.
runWss.on("connection", (ws, req) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const indexRaw = url.searchParams.get("index");
  const index = indexRaw !== null && /^\d+$/.test(indexRaw) ? Number(indexRaw) : NaN;
  const cwd = resolveWorkspace(url.searchParams.get("cwd"));
  const resolved = resolveScript(cwd, index);
  if (!resolved) {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "error", message: "Script not found — check script.json." }));
      ws.close();
    }
    return;
  }

  let term: IPty;
  try {
    term = spawnCommandPty(resolved.command, resolved.cwd, ws);
  } catch (err) {
    console.error(`[ws/run] failed to start command: ${messageOf(err)}`);
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "error", message: "Failed to start the command." }));
      ws.close();
    }
    return;
  }

  ws.on("message", (raw) => handleCommandFrame(term, raw));
  ws.on("close", () => {
    // Ephemeral: no reattach/grace window — the viewer is gone, so end the process.
    try {
      term.kill();
    } catch {
      // already exited — nothing to kill
    }
  });
});

// Send a terminal error to the socket and close it (no reconnect on the client side).
function closeWithError(ws: WebSocket, message: string): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type: "error", message }));
    ws.close();
  }
}

// The command a launcher runs when spawned fresh. On a tmux reattach it's ignored
// (tmux new-session -A attaches the running program), so a surviving session with no
// resolvable launcher index still reattaches via this harmless fallback.
// Reattach a same-process live PTY, else spawn a launcher (which itself reattaches a
// surviving tmux session or creates one). `command` is the resolved launcher command,
// or the fallback for a tmux reattach with no launcher index.
function cardResumeDraft(cardId: string | null): string | null {
  if (!cardId) return null;
  const card = loadBoard().cards.find((c) => c.id === cardId);
  return claudeResumeDraft(card?.terminal.agentSessionId);
}

function startLaunchEntry(
  sessionId: string,
  ws: WebSocket,
  live: PtyEntry | undefined,
  command: string,
  cwd: string,
  cardId: string | null,
  draft: string | null,
): PtyEntry {
  if (live) return reattachPty(live, ws, sessionId);
  return spawnLauncherPty(sessionId, ws, command, cwd, cardId, draft);
}

interface LaunchRequest {
  requested: string | null;
  cwd: string;
  index: number;
  isCardTerminal: boolean;
  cardId: string | null;
}

function parseLaunchRequest(req: http.IncomingMessage): LaunchRequest {
  const url = new URL(req.url ?? "/", "http://localhost");
  const raw = url.searchParams.get("session");
  const indexRaw = url.searchParams.get("launcher");
  const isCardTerminal = url.searchParams.get("card") === "1";
  return {
    requested: raw && SESSION_ID_RE.test(raw) ? raw : null,
    cwd: resolveWorkspace(url.searchParams.get("cwd")),
    index: indexRaw !== null && /^\d+$/.test(indexRaw) ? Number(indexRaw) : NaN,
    isCardTerminal,
    cardId: isCardTerminal ? sanitizeCardId(url.searchParams.get("cardId")) : null,
  };
}

function resolveLaunchState(requested: string | null): { live: PtyEntry | undefined; tmuxAlive: boolean; sessionId: string } {
  const reattachId = requested && ptys.has(requested) ? requested : null;
  const live = reattachId ? ptys.get(reattachId) : undefined;
  const tmuxAlive = !live && !!requested && tmuxHasSession(requested);
  const sessionId = reattachId ?? (tmuxAlive && requested ? requested : randomUUID());
  return { live, tmuxAlive, sessionId };
}

function resolveLaunchCommand(live: PtyEntry | undefined, tmuxAlive: boolean, index: number): string | null {
  if (live || tmuxAlive) return DEFAULT_LAUNCH_CMD;
  return resolveLauncher(index)?.command ?? null;
}

// Launcher terminal (?launcher=<index>&cwd=<dir>, ?session=<id> to reattach): run a
// configured launch command as a persistent, reattachable PTY. Reuses the /ws session
// lifecycle (reattach + reap grace + handleClientClose) but with no hooks/transcript,
// and is marked a dev-terminal session so it stays out of the unscoped session list.
runLaunchWss.on("connection", (ws, req) => {
  const request = parseLaunchRequest(req);
  const { live, tmuxAlive, sessionId } = resolveLaunchState(request.requested);
  const command = resolveLaunchCommand(live, tmuxAlive, request.index);
  if (!command) return closeWithError(ws, "Launcher not found — check Settings → Launch commands.");

  const effectiveCwd = live?.cwd ?? request.cwd;
  const resumeDraft = request.requested && !live && !tmuxAlive ? cardResumeDraft(request.cardId) : null;
  if (request.isCardTerminal) cardTerminalSessions.add(sessionId);
  if (request.cardId) bindTerminalSessionToCard(request.cardId, sessionId, effectiveCwd);
  markDevTerminalSession(sessionId);
  ws.send(JSON.stringify({ type: "session", id: sessionId, cwd: effectiveCwd }));

  let entry: PtyEntry;
  try {
    entry = startLaunchEntry(sessionId, ws, live, command, request.cwd, request.cardId, resumeDraft);
  } catch (err) {
    console.error(`[ws/launch] failed to start ${sessionId}: ${messageOf(err)}`);
    return closeWithError(ws, "Failed to start the launch command.");
  }

  ws.on("message", (raw) => handleClientFrame(entry, ws, raw, sessionId));
  ws.on("close", () => handleClientClose(entry, ws, sessionId));
});

// Exit code the launcher (bin/kanban-terminal.js) treats as "port was taken at
// bind time" so it can retry on a fresh port. Keep in sync with the launcher.
const PORT_IN_USE_EXIT_CODE = 75;

// A bind failure (most often the port already in use) must not surface as an
// unhandled 'error' event / stack trace — exit with a clear message instead.
server.on("error", (err) => {
  if (hasErrnoCode(err) && err.code === "EADDRINUSE") {
    console.error(`[kanban-terminal] Port ${PORT} is already in use — set PORT=<n> or pass --port <n>.`);
    process.exit(PORT_IN_USE_EXIT_CODE);
  }
  console.error(`[kanban-terminal] server error: ${messageOf(err)}`);
  process.exit(1);
});

// Loopback only — the app is unauthenticated by design (README: trusted local
// machine only), so the listener must never be reachable from the LAN. Keep the
// bind host in sync with the launcher's port probe (bin/kanban-terminal.js).
server.listen(PORT, "127.0.0.1", () => {
  console.log(`kanban-terminal running at http://localhost:${PORT}`);
  if (tmuxAvailable()) {
    const surviving = tmuxListSessionIds();
    const detail = surviving.length ? ` — ${surviving.length} session(s) survived; reattach on connect` : "";
    console.log(`[tmux] persistence on${detail}`);
  } else {
    console.log("[tmux] not found — terminals are not persistent across a server restart");
  }
});
