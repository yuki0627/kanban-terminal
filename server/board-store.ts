import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type LaneId = "todo" | "in_progress" | "in_review" | "done" | "canceled";
export type AgentKind = "claude" | "shell";
export type CellStatus = "blocked" | "done" | "working" | "idle";

export interface Project {
  id: string;
  root: string;
  name: string;
  color: string;
  sidebarVisible: boolean;
  order: number;
}

export interface Card {
  id: string;
  projectId: string | null;
  name: string;
  memo: string;
  lane: LaneId;
  archived: boolean;
  unread: boolean;
  terminal: {
    sessionId: string | null;
    agentKind: AgentKind;
    cwd: string | null;
    agentSessionId?: string | null;
  };
  overlay: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  createdAt: number;
  updatedAt: number;
  manual: boolean;
  lastStatus: CellStatus;
}

export interface BoardState {
  projects: Project[];
  cards: Card[];
}

export const BOARD_FILE = path.join(os.homedir(), ".kanban-terminal", "board.json");

const LANES: ReadonlySet<unknown> = new Set(["todo", "in_progress", "in_review", "done", "canceled"]);
const AGENTS: ReadonlySet<unknown> = new Set(["claude", "shell"]);
const STATUSES: ReadonlySet<unknown> = new Set(["blocked", "done", "working", "idle"]);
const FINISHED: ReadonlySet<LaneId> = new Set(["done", "canceled"]);
const COLORS = ["#2563eb", "#16a34a", "#dc2626", "#9333ea", "#ea580c", "#0891b2", "#4f46e5", "#be123c"];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const text = (v: unknown, fallback: string): string => (typeof v === "string" && v.trim() ? v.trim() : fallback);
const maybeText = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const timestamp = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

export function emptyBoard(): BoardState {
  return { projects: [], cards: [] };
}

function basename(root: string): string {
  return path.basename(root) || root;
}

function sanitizeProject(raw: unknown, index: number, seenIds: Set<string>, seenRoots: Set<string>): Project | null {
  if (!isRecord(raw)) return null;
  const root = text(raw.root, "");
  if (!root || !path.isAbsolute(root) || seenRoots.has(root)) return null;
  const id = text(raw.id, `project-${index + 1}`);
  if (seenIds.has(id)) return null;
  seenIds.add(id);
  seenRoots.add(root);
  return {
    id,
    root,
    name: text(raw.name, basename(root)),
    color: text(raw.color, COLORS[index % COLORS.length]),
    sidebarVisible: raw.sidebarVisible !== false,
    order: timestamp(raw.order, index),
  };
}

function sanitizeCard(raw: unknown, projectIds: Set<string>, index: number): Card | null {
  if (!isRecord(raw)) return null;
  const id = text(raw.id, "");
  if (!id) return null;
  const terminal = isRecord(raw.terminal) ? raw.terminal : {};
  const sessionId = maybeText(terminal.sessionId) ?? maybeText(raw.sessionId) ?? maybeText(raw.session);
  const legacyName = maybeText(raw.title) ?? maybeText(raw.text) ?? `Card ${index + 1}`;
  const now = Date.now();
  const projectId = typeof raw.projectId === "string" && projectIds.has(raw.projectId) ? raw.projectId : null;
  const agentKind = AGENTS.has(terminal.agentKind) ? (terminal.agentKind as AgentKind) : "shell";
  const overlay = isRecord(raw.overlay) ? raw.overlay : {};
  const overlayX = timestamp(overlay.x, NaN);
  const overlayY = timestamp(overlay.y, NaN);
  const overlayWidth = timestamp(overlay.width, NaN);
  const overlayHeight = timestamp(overlay.height, NaN);
  return {
    id,
    projectId,
    name: text(raw.name, legacyName),
    memo: typeof raw.memo === "string" ? raw.memo : "",
    lane: LANES.has(raw.lane) ? (raw.lane as LaneId) : "todo",
    archived: raw.archived === true,
    unread: raw.unread === true,
    terminal: {
      sessionId,
      agentKind,
      cwd: maybeText(terminal.cwd),
      agentSessionId: maybeText(terminal.agentSessionId) ?? maybeText(terminal.agentSession),
    },
    overlay:
      Number.isFinite(overlayX) && Number.isFinite(overlayY) && Number.isFinite(overlayWidth) && Number.isFinite(overlayHeight)
        ? { x: overlayX, y: overlayY, width: overlayWidth, height: overlayHeight }
        : null,
    createdAt: timestamp(raw.createdAt, now),
    updatedAt: timestamp(raw.updatedAt, now),
    manual: raw.manual === true,
    lastStatus: STATUSES.has(raw.lastStatus) ? (raw.lastStatus as CellStatus) : "idle",
  };
}

export function sanitizeBoard(input: unknown): BoardState {
  if (!isRecord(input)) return emptyBoard();
  const seenIds = new Set<string>();
  const seenRoots = new Set<string>();
  const projects = (Array.isArray(input.projects) ? input.projects : [])
    .map((p, i) => sanitizeProject(p, i, seenIds, seenRoots))
    .filter((p): p is Project => p !== null)
    .sort((a, b) => a.order - b.order);
  const projectIds = new Set(projects.map((p) => p.id));
  const seenCards = new Set<string>();
  const cards: Card[] = [];
  for (const [index, raw] of (Array.isArray(input.cards) ? input.cards : []).entries()) {
    const card = sanitizeCard(raw, projectIds, index);
    if (!card || seenCards.has(card.id)) continue;
    seenCards.add(card.id);
    cards.push(card);
  }
  return { projects, cards };
}

export function loadBoard(file = BOARD_FILE): BoardState {
  try {
    if (!existsSync(file)) return emptyBoard();
    return sanitizeBoard(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return emptyBoard();
  }
}

export function saveBoard(board: BoardState, file = BOARD_FILE): boolean {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(sanitizeBoard(board), null, 2));
    return true;
  } catch {
    return false;
  }
}

export function laneForStatus(status: CellStatus): LaneId | undefined {
  if (status === "working") return "in_progress";
  if (status === "done" || status === "blocked") return "in_review";
  return undefined;
}

interface ApplyCardStatusOptions {
  viewed?: boolean;
}

export function applyCardStatus(board: BoardState, cardId: string, status: CellStatus, options: ApplyCardStatusOptions = {}): BoardState {
  const card = board.cards.find((c) => c.id === cardId);
  if (!card || card.archived || card.lastStatus === status) return board;
  const target = laneForStatus(status);
  const protectedFinish = card.manual && FINISHED.has(card.lane) && status !== "working";
  const lane = target !== undefined && !protectedFinish ? target : card.lane;
  const moved = lane !== card.lane;
  const next: Card = {
    ...card,
    lane,
    lastStatus: status,
    updatedAt: Date.now(),
    manual: moved ? false : card.manual,
    unread: options.viewed ? false : card.unread || moved,
  };
  return { ...board, cards: board.cards.map((c) => (c.id === cardId ? next : c)) };
}

export function markCardRead(board: BoardState, cardId: string): BoardState {
  const card = board.cards.find((c) => c.id === cardId);
  if (!card || !card.unread) return board;
  return { ...board, cards: board.cards.map((c) => (c.id === cardId ? { ...c, unread: false, updatedAt: Date.now() } : c)) };
}
