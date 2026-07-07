// The kanban board maps terminal-backed cards into five lanes. Process and agent
// signals move cards automatically; To Do / Done / Canceled remain human decisions.
// idle is the absence of a signal, never a destination.

import type { CellStatus } from "./activityStatus";

export type LaneId = "todo" | "in_progress" | "in_review" | "done" | "canceled";
export type AgentKind = "claude" | "shell";

export const LANES: ReadonlyArray<{ id: LaneId; title: string }> = [
  { id: "todo", title: "To Do" },
  { id: "in_progress", title: "In Progress" },
  { id: "in_review", title: "In Review" },
  { id: "done", title: "Done" },
  { id: "canceled", title: "Canceled" },
];

export interface Project {
  id: string;
  root: string;
  name: string;
  color: string;
  sidebarVisible: boolean;
  order: number;
}

export interface CardTerminal {
  sessionId: string | null;
  agentKind: AgentKind;
  cwd: string | null;
  agentSessionId?: string | null;
}

export interface OverlayFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface KanbanCard {
  id: string;
  projectId: string | null;
  name: string;
  memo: string;
  lane: LaneId;
  archived: boolean;
  unread: boolean;
  terminal: CardTerminal;
  overlay: OverlayFrame | null;
  createdAt: number;
  updatedAt: number;
  /** Set by a user drag; cleared when a real work-start moves the card again.
   *  While set on a finished lane (done/canceled), waiting statuses are ignored. */
  manual: boolean;
  /** The status the last transition was computed from (edge-trigger memory). */
  lastStatus: CellStatus;
}

export interface KanbanState {
  projects: Project[];
  /** All cards, in board order; a lane renders its subset in this order. */
  cards: KanbanCard[];
  /** Card id open in the live-terminal overlay, or null. UI-local, not persisted. */
  expanded: string | null;
}

export interface SessionSnapshot {
  id: string;
  status: CellStatus;
  title?: string;
  cwd?: string | null;
}

export const emptyKanbanState = (): KanbanState => ({ projects: [], cards: [], expanded: null });

/** Lanes a user can finish a card into; protected from automatic pull-back. */
const FINISHED: ReadonlyArray<LaneId> = ["done", "canceled"];

/** The lane a status SIGNALS, or undefined when it signals nothing. */
export function laneForStatus(status: CellStatus): LaneId | undefined {
  if (status === "working") return "in_progress";
  if (status === "done" || status === "blocked") return "in_review";
  return undefined;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isLane = (v: unknown): v is LaneId => LANES.some((lane) => lane.id === v);
const isAgentKind = (v: unknown): v is AgentKind => v === "claude" || v === "shell";
const isCellStatus = (v: unknown): v is CellStatus => v === "blocked" || v === "done" || v === "working" || v === "idle";
const firstString = (...values: unknown[]): string | null => values.find((v): v is string => typeof v === "string") ?? null;

function parseOverlayFrame(raw: unknown): OverlayFrame | null {
  if (!isRecord(raw)) return null;
  const x = typeof raw.x === "number" && Number.isFinite(raw.x) ? raw.x : null;
  const y = typeof raw.y === "number" && Number.isFinite(raw.y) ? raw.y : null;
  const width = typeof raw.width === "number" && Number.isFinite(raw.width) ? raw.width : null;
  const height = typeof raw.height === "number" && Number.isFinite(raw.height) ? raw.height : null;
  if (x === null || y === null || width === null || height === null) return null;
  return { x, y, width, height };
}

function parseCard(raw: unknown): KanbanCard | null {
  if (!isRecord(raw) || typeof raw.id !== "string") return null;
  const terminal = isRecord(raw.terminal) ? raw.terminal : {};
  const sessionId = firstString(terminal.sessionId, raw.sessionId, raw.session);
  const legacyName = firstString(raw.title, raw.text) ?? "Untitled";
  const now = Date.now();
  return {
    id: raw.id,
    projectId: typeof raw.projectId === "string" ? raw.projectId : null,
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name : legacyName,
    memo: typeof raw.memo === "string" ? raw.memo : "",
    lane: isLane(raw.lane) ? raw.lane : "todo",
    archived: raw.archived === true,
    unread: raw.unread === true,
    terminal: {
      sessionId,
      agentKind: isAgentKind(terminal.agentKind) ? terminal.agentKind : "shell",
      cwd: typeof terminal.cwd === "string" ? terminal.cwd : null,
      agentSessionId: firstString(terminal.agentSessionId, terminal.agentSession),
    },
    overlay: parseOverlayFrame(raw.overlay),
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : now,
    manual: raw.manual === true,
    lastStatus: isCellStatus(raw.lastStatus) ? raw.lastStatus : "idle",
  };
}

function parseProject(raw: unknown): Project | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.root !== "string") return null;
  return {
    id: raw.id,
    root: raw.root,
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name : raw.root.split("/").filter(Boolean).at(-1) || raw.root,
    color: typeof raw.color === "string" && raw.color.trim() ? raw.color : "#64748b",
    sidebarVisible: raw.sidebarVisible !== false,
    order: typeof raw.order === "number" && Number.isFinite(raw.order) ? raw.order : 0,
  };
}

export function initialKanbanState(saved: unknown): KanbanState {
  const parsed = typeof saved === "string" ? parseJson(saved) : saved;
  if (!isRecord(parsed)) return emptyKanbanState();
  const projects = Array.isArray(parsed.projects) ? parsed.projects.map(parseProject).filter((p): p is Project => p !== null) : [];
  const cards = Array.isArray(parsed.cards) ? parsed.cards.map(parseCard).filter((c): c is KanbanCard => c !== null) : [];
  return { projects: projects.sort((a, b) => a.order - b.order), cards, expanded: null };
}

function parseJson(raw: string | null): unknown {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function cardForSession(state: KanbanState, sessionId: string): KanbanCard | undefined {
  return state.cards.find((c) => c.terminal.sessionId === sessionId);
}

/** Apply one session's current status. Automatic transitions are edge-triggered
 *  and never touch manually finished cards except on a real work-start. */
export function applyStatus(state: KanbanState, sessionId: string, status: CellStatus): KanbanState {
  const card = cardForSession(state, sessionId);
  if (!card || card.lastStatus === status) return state;
  const target = laneForStatus(status);
  const protectedFinish = card.manual && FINISHED.includes(card.lane) && status !== "working";
  const lane = target !== undefined && !protectedFinish ? target : card.lane;
  const moved = lane !== card.lane;
  const next: KanbanCard = {
    ...card,
    lane,
    lastStatus: status,
    updatedAt: Date.now(),
    manual: moved ? false : card.manual,
    unread: card.unread || (moved && state.expanded !== card.id),
  };
  return { ...state, cards: state.cards.map((c) => (c.id === card.id ? next : c)) };
}

function uniqueCardId(seed: string, cards: ReadonlyArray<KanbanCard>): string {
  const used = new Set(cards.map((c) => c.id));
  let id = seed;
  let n = 2;
  while (used.has(id)) id = `${seed}-${n++}`;
  return id;
}

/** Reconcile with the server's session list. Unknown sessions become cards; known
 *  sessions run applyStatus. Cards are not dropped when a transcript disappears,
 *  because board/card state is now authoritative and server-persisted. */
export function syncSessions(state: KanbanState, sessions: ReadonlyArray<SessionSnapshot>): KanbanState {
  const known = new Set(state.cards.map((c) => c.terminal.sessionId).filter((id): id is string => !!id));
  let next = state;
  const added: KanbanCard[] = [];
  const now = Date.now();
  for (const s of sessions) {
    if (known.has(s.id)) {
      next = applyStatus(next, s.id, s.status);
    } else {
      added.push({
        id: uniqueCardId(`session-${s.id}`, [...next.cards, ...added]),
        projectId: null,
        name: s.title || s.id.slice(0, 8),
        memo: "",
        lane: laneForStatus(s.status) ?? "todo",
        archived: false,
        unread: false,
        terminal: { sessionId: s.id, agentKind: "claude", cwd: s.cwd ?? null },
        overlay: null,
        createdAt: now,
        updatedAt: now,
        manual: false,
        lastStatus: s.status,
      });
    }
  }
  return added.length ? { ...next, cards: [...added, ...next.cards] } : next;
}

/** A user drag: place the card wherever they want, mark it manual, and clear unread. */
export function moveCard(state: KanbanState, cardId: string, lane: LaneId): KanbanState {
  const card = state.cards.find((c) => c.id === cardId);
  if (!card) return state;
  const moved: KanbanCard = { ...card, lane, manual: true, unread: false, updatedAt: Date.now() };
  return { ...state, cards: [moved, ...state.cards.filter((c) => c.id !== cardId)] };
}

/** Open (or close, with null) the live-terminal overlay; opening clears unread. */
export function setExpanded(state: KanbanState, cardId: string | null): KanbanState {
  const cards = cardId === null ? state.cards : state.cards.map((c) => (c.id === cardId ? { ...c, unread: false } : c));
  return { ...state, cards, expanded: cardId };
}

export function updateCard(state: KanbanState, cardId: string, patch: Partial<KanbanCard>): KanbanState {
  return { ...state, cards: state.cards.map((c) => (c.id === cardId ? { ...c, ...patch, updatedAt: Date.now() } : c)) };
}

export function archiveCards(state: KanbanState, cardIds: ReadonlyArray<string>): KanbanState {
  const ids = new Set(cardIds);
  if (!ids.size) return state;
  let changed = false;
  const cards = state.cards.map((c) => {
    if (!ids.has(c.id) || c.archived) return c;
    changed = true;
    return { ...c, archived: true, unread: false, updatedAt: Date.now() };
  });
  return changed ? { ...state, cards, expanded: state.expanded && ids.has(state.expanded) ? null : state.expanded } : state;
}

export function restoreCard(state: KanbanState, cardId: string, lane: LaneId): KanbanState {
  const card = state.cards.find((c) => c.id === cardId);
  if (!card || !card.archived) return state;
  const restored: KanbanCard = { ...card, archived: false, lane, manual: true, unread: false, updatedAt: Date.now() };
  return { ...state, cards: [restored, ...state.cards.filter((c) => c.id !== cardId)] };
}

export function updateOverlayFrame(state: KanbanState, cardId: string, overlay: OverlayFrame): KanbanState {
  return updateCard(state, cardId, { overlay });
}

export function laneCards(state: KanbanState, lane: LaneId): KanbanCard[] {
  return state.cards.filter((c) => !c.archived && c.lane === lane);
}

export function archivedCards(state: KanbanState): KanbanCard[] {
  return state.cards.filter((c) => c.archived);
}

export type LaneCounts = Record<LaneId, number>;

export function countByLane(state: KanbanState): LaneCounts {
  const counts: LaneCounts = { todo: 0, in_progress: 0, in_review: 0, done: 0, canceled: 0 };
  for (const c of state.cards) if (!c.archived) counts[c.lane]++;
  return counts;
}
