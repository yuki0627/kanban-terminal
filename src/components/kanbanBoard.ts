// The kanban board maps each Claude session to a card in one of five lanes and
// moves the card automatically as the agent's live activity changes: real work
// (working) pulls it to In Progress, needing the user (waiting) pushes it to
// In Review. To Do / Done / Canceled are HUMAN concepts the agent state can't
// express, so they are only ever reached by a manual drag — and a manually
// finished card is protected from being dragged back by mere status noise.
//
// Statuses arrive as repeated SNAPSHOTS (every "sessions" pub/sub push re-sends
// the current state), not as one-shot events, so every automatic transition is
// edge-triggered on a status CHANGE (`lastStatus`). This also means a server
// restart — which resets the in-memory activity map to idle — parks cards where
// they are instead of dumping them back to To Do: idle is the absence of a
// signal, never a destination.
//
// KanbanView owns a single KanbanState ref and drives it through these pure
// transforms, persisting to localStorage.

import type { CellStatus } from "./activityStatus";

export type LaneId = "todo" | "in_progress" | "in_review" | "done" | "canceled";

export const LANES: ReadonlyArray<{ id: LaneId; title: string }> = [
  { id: "todo", title: "To Do" },
  { id: "in_progress", title: "In Progress" },
  { id: "in_review", title: "In Review" },
  { id: "done", title: "Done" },
  { id: "canceled", title: "Canceled" },
];

export interface KanbanCard {
  /** The Claude session this card tracks (the server's session id). */
  session: string;
  lane: LaneId;
  /** Set by a user drag; cleared when a real work-start moves the card again.
   *  While set on a finished lane (done/canceled), waiting statuses are ignored. */
  manual: boolean;
  /** An automatic lane change happened while the card wasn't open — badge it. */
  unread: boolean;
  /** The status the last transition was computed from (edge-trigger memory). */
  lastStatus: CellStatus;
}

export interface KanbanState {
  /** All cards, in board order; a lane renders its subset in this order. */
  cards: KanbanCard[];
  /** Session id of the card open in the live-terminal overlay, or null. */
  expanded: string | null;
}

export const KANBAN_STATE_KEY = "kanban_v1";

/** Lanes a user can finish a card into; protected from automatic pull-back. */
const FINISHED: ReadonlyArray<LaneId> = ["done", "canceled"];

/** The lane a status SIGNALS, or undefined when it signals nothing (idle: the
 *  activity map simply has no entry — e.g. after a server restart). */
export function laneForStatus(status: CellStatus): LaneId | undefined {
  if (status === "working") return "in_progress";
  if (status === "done" || status === "blocked") return "in_review";
  return undefined;
}

export function initialKanbanState(saved: string | null): KanbanState {
  if (saved) {
    try {
      const parsed = JSON.parse(saved) as KanbanState;
      if (Array.isArray(parsed.cards)) {
        return { cards: parsed.cards.filter((c) => typeof c.session === "string"), expanded: null };
      }
    } catch {
      // fall through to a fresh board
    }
  }
  return { cards: [], expanded: null };
}

/** Apply one session's current status. Automatic transitions are edge-triggered
 *  (no-op unless the status changed) and never touch manually finished cards —
 *  except a real work-start (working), which re-opens them to In Progress. An
 *  automatic move on a card that isn't open marks it unread. */
export function applyStatus(state: KanbanState, session: string, status: CellStatus): KanbanState {
  const card = state.cards.find((c) => c.session === session);
  if (!card || card.lastStatus === status) return state;
  const target = laneForStatus(status);
  const protectedFinish = card.manual && FINISHED.includes(card.lane) && status !== "working";
  const lane = target !== undefined && !protectedFinish ? target : card.lane;
  const moved = lane !== card.lane;
  const next: KanbanCard = {
    ...card,
    lane,
    lastStatus: status,
    manual: moved ? false : card.manual,
    unread: card.unread || (moved && state.expanded !== session),
  };
  return { ...state, cards: state.cards.map((c) => (c.session === session ? next : c)) };
}

/** Reconcile the board with the server's authoritative session list: unknown
 *  sessions become new cards (placed by their CURRENT status — first sight is
 *  placement, not a transition, so no unread), known ones run applyStatus, and
 *  vanished ones drop out. New cards are prepended (the server returns
 *  newest-first) and existing cards keep their board order. */
export function syncSessions(state: KanbanState, sessions: ReadonlyArray<{ id: string; status: CellStatus }>): KanbanState {
  const known = new Set(state.cards.map((c) => c.session));
  const incoming = new Set(sessions.map((s) => s.id));
  let next: KanbanState = { ...state, cards: state.cards.filter((c) => incoming.has(c.session)) };
  const added: KanbanCard[] = [];
  for (const s of sessions) {
    if (known.has(s.id)) {
      next = applyStatus(next, s.id, s.status);
    } else {
      added.push({ session: s.id, lane: laneForStatus(s.status) ?? "todo", manual: false, unread: false, lastStatus: s.status });
    }
  }
  return { ...next, cards: [...added, ...next.cards] };
}

/** A user drag: place the card wherever they want, mark it manual (protecting a
 *  finished lane from status noise), and clear unread — they've clearly seen it.
 *  The card moves to the front of the board order so it lands at the top of its
 *  new lane. */
export function moveCard(state: KanbanState, session: string, lane: LaneId): KanbanState {
  const card = state.cards.find((c) => c.session === session);
  if (!card) return state;
  const moved: KanbanCard = { ...card, lane, manual: true, unread: false };
  return { ...state, cards: [moved, ...state.cards.filter((c) => c.session !== session)] };
}

/** Open (or close, with null) the live-terminal overlay; opening clears unread. */
export function setExpanded(state: KanbanState, session: string | null): KanbanState {
  const cards = session === null ? state.cards : state.cards.map((c) => (c.session === session ? { ...c, unread: false } : c));
  return { cards, expanded: session };
}

export function laneCards(state: KanbanState, lane: LaneId): KanbanCard[] {
  return state.cards.filter((c) => c.lane === lane);
}

export type LaneCounts = Record<LaneId, number>;

export function countByLane(state: KanbanState): LaneCounts {
  const counts: LaneCounts = { todo: 0, in_progress: 0, in_review: 0, done: 0, canceled: 0 };
  for (const c of state.cards) counts[c.lane]++;
  return counts;
}
