import { describe, it, expect } from "vitest";
import {
  emptyKanbanState,
  initialKanbanState,
  laneForStatus,
  moveCard,
  setExpanded,
  laneCards,
  archiveCards,
  archivedCards,
  countByLane,
  restoreCard,
  updateOverlayFrame,
  updateMemoPanel,
  type KanbanState,
  type KanbanCard,
} from "./kanbanBoard";

const card = (over: Partial<KanbanCard> = {}): KanbanCard => ({
  id: "c1",
  projectId: null,
  name: "Task",
  memo: "",
  lane: "todo",
  archived: false,
  unread: false,
  terminal: { sessionId: "s1", agentKind: "claude", cwd: null },
  overlay: null,
  memoPanel: null,
  createdAt: 1,
  updatedAt: 1,
  manual: false,
  lastStatus: "idle",
  ...over,
});

const state = (cards: KanbanCard[], expanded: string | null = null): KanbanState => ({ projects: [], cards, expanded });

describe("laneForStatus", () => {
  it("maps working to in_progress and waiting (done/blocked) to in_review", () => {
    expect(laneForStatus("working")).toBe("in_progress");
    expect(laneForStatus("done")).toBe("in_review");
    expect(laneForStatus("blocked")).toBe("in_review");
  });

  it("treats idle as no signal, not a destination", () => {
    expect(laneForStatus("idle")).toBeUndefined();
  });
});

describe("initialKanbanState", () => {
  it("starts empty without saved state and survives corrupt JSON", () => {
    expect(initialKanbanState(null)).toEqual(emptyKanbanState());
    expect(initialKanbanState("{nope")).toEqual(emptyKanbanState());
    expect(initialKanbanState({ cards: "x" })).toEqual(emptyKanbanState());
  });

  it("restores projects and cards but never a stale expanded overlay", () => {
    const saved = JSON.stringify({ projects: [{ id: "p1", root: "/work/app" }], cards: [card()], expanded: "c1" });
    const restored = initialKanbanState(saved);
    expect(restored.expanded).toBeNull();
    expect(restored.projects[0]).toMatchObject({ id: "p1", root: "/work/app", sidebarVisible: true });
    expect(restored.cards[0]).toMatchObject({ id: "c1", terminal: { sessionId: "s1", agentKind: "claude", cwd: null } });
  });

  it("defaults untyped cards to shell terminals", () => {
    const restored = initialKanbanState({ cards: [{ id: "c1", name: "Task" }] });
    expect(restored.cards[0].terminal.agentKind).toBe("shell");
  });

  it("restores a saved memo panel and drops malformed ones", () => {
    const restored = initialKanbanState({
      cards: [{ id: "c1", memoPanel: { collapsed: true, height: 140 } }, { id: "c2", memoPanel: { collapsed: "yes", height: "tall" } }, { id: "c3" }],
    });
    expect(restored.cards[0].memoPanel).toEqual({ collapsed: true, height: 140 });
    expect(restored.cards[1].memoPanel).toBeNull();
    expect(restored.cards[2].memoPanel).toBeNull();
  });
});

describe("archive and restore", () => {
  it("archives selected cards, clears unread, and closes an archived overlay", () => {
    const s = archiveCards(state([card({ unread: true }), card({ id: "b" })], "c1"), ["c1"]);
    expect(s.expanded).toBeNull();
    expect(s.cards[0]).toMatchObject({ id: "c1", archived: true, unread: false });
    expect(archivedCards(s).map((c) => c.id)).toEqual(["c1"]);
  });

  it("restores an archived card to the dropped lane and floats it to that lane top", () => {
    const s = restoreCard(state([card({ archived: true }), card({ id: "b", lane: "done" })]), "c1", "done");
    expect(s.cards[0]).toMatchObject({ id: "c1", archived: false, lane: "done", manual: true });
    expect(laneCards(s, "done").map((c) => c.id)).toEqual(["c1", "b"]);
  });
});

describe("updateOverlayFrame", () => {
  it("persists the user-sized card window frame", () => {
    const s = updateOverlayFrame(state([card()]), "c1", { x: 10, y: 20, width: 900, height: 640 });
    expect(s.cards[0].overlay).toEqual({ x: 10, y: 20, width: 900, height: 640 });
  });
});

describe("updateMemoPanel", () => {
  it("persists the per-card memo collapse state and panel height", () => {
    const s = updateMemoPanel(state([card()]), "c1", { collapsed: true, height: 140 });
    expect(s.cards[0].memoPanel).toEqual({ collapsed: true, height: 140 });
  });

  it("ignores unknown cards", () => {
    const before = state([card()]);
    expect(updateMemoPanel(before, "ghost", { collapsed: false, height: 120 }).cards).toEqual(before.cards);
  });
});

describe("moveCard", () => {
  it("is manual, clears unread, and floats the card to the top of its lane", () => {
    const s = moveCard(state([card({ id: "a", unread: true }), card({ id: "b", lane: "done" })]), "a", "done");
    expect(s.cards[0]).toMatchObject({ id: "a", lane: "done", manual: true, unread: false });
    expect(laneCards(s, "done").map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("ignores unknown cards", () => {
    const before = state([card()]);
    expect(moveCard(before, "ghost", "done")).toBe(before);
  });
});

describe("setExpanded", () => {
  it("opening a card clears its unread badge; closing leaves cards untouched", () => {
    const opened = setExpanded(state([card({ unread: true })]), "c1");
    expect(opened.expanded).toBe("c1");
    expect(opened.cards[0].unread).toBe(false);
    const closed = setExpanded(opened, null);
    expect(closed.expanded).toBeNull();
  });
});

describe("countByLane", () => {
  it("tallies every non-archived lane", () => {
    const s = state([card(), card({ id: "s2", lane: "in_review" }), card({ id: "s3", lane: "in_review", archived: true })]);
    expect(countByLane(s)).toEqual({ todo: 1, in_progress: 0, in_review: 1, done: 0, canceled: 0 });
  });
});
