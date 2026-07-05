import { describe, it, expect } from "vitest";
import {
  initialKanbanState,
  laneForStatus,
  applyStatus,
  syncSessions,
  moveCard,
  setExpanded,
  laneCards,
  countByLane,
  type KanbanState,
  type KanbanCard,
} from "./kanbanBoard";

const card = (over: Partial<KanbanCard> = {}): KanbanCard => ({
  session: "s1",
  lane: "todo",
  manual: false,
  unread: false,
  lastStatus: "idle",
  ...over,
});

const state = (cards: KanbanCard[], expanded: string | null = null): KanbanState => ({ cards, expanded });

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
    expect(initialKanbanState(null)).toEqual({ cards: [], expanded: null });
    expect(initialKanbanState("{nope")).toEqual({ cards: [], expanded: null });
    expect(initialKanbanState('{"cards":"x"}')).toEqual({ cards: [], expanded: null });
  });

  it("restores saved cards but never a stale expanded overlay", () => {
    const saved = JSON.stringify(state([card()], "s1"));
    expect(initialKanbanState(saved)).toEqual({ cards: [card()], expanded: null });
  });
});

describe("applyStatus", () => {
  it("moves a card to in_progress when work starts and to in_review when the agent waits", () => {
    let s = state([card()]);
    s = applyStatus(s, "s1", "working");
    expect(s.cards[0].lane).toBe("in_progress");
    s = applyStatus(s, "s1", "done");
    expect(s.cards[0].lane).toBe("in_review");
  });

  it("is edge-triggered: a re-sent snapshot of the same status is a no-op", () => {
    const before = state([card({ lane: "in_review", lastStatus: "done", manual: true })]);
    expect(applyStatus(before, "s1", "done")).toBe(before);
  });

  it("parks the card where it is on idle (e.g. after a server restart)", () => {
    const s = applyStatus(state([card({ lane: "in_review", lastStatus: "done" })]), "s1", "idle");
    expect(s.cards[0].lane).toBe("in_review");
    expect(s.cards[0].lastStatus).toBe("idle");
  });

  it("protects a manually finished card from waiting statuses", () => {
    for (const lane of ["done", "canceled"] as const) {
      const s = applyStatus(state([card({ lane, manual: true })]), "s1", "blocked");
      expect(s.cards[0].lane).toBe(lane);
    }
  });

  it("re-opens a manually finished card only on a real work-start", () => {
    const s = applyStatus(state([card({ lane: "done", manual: true })]), "s1", "working");
    expect(s.cards[0].lane).toBe("in_progress");
    expect(s.cards[0].manual).toBe(false);
  });

  it("marks an automatic move unread unless the card is open in the overlay", () => {
    const closed = applyStatus(state([card()]), "s1", "working");
    expect(closed.cards[0].unread).toBe(true);
    const open = applyStatus(state([card()], "s1"), "s1", "working");
    expect(open.cards[0].unread).toBe(false);
  });

  it("ignores unknown sessions", () => {
    const before = state([card()]);
    expect(applyStatus(before, "ghost", "working")).toBe(before);
  });
});

describe("syncSessions", () => {
  it("places a first-seen session by its current status without marking unread", () => {
    const s = syncSessions(state([]), [
      { id: "a", status: "working" },
      { id: "b", status: "done" },
      { id: "c", status: "idle" },
    ]);
    expect(s.cards.map((c) => [c.session, c.lane, c.unread])).toEqual([
      ["a", "in_progress", false],
      ["b", "in_review", false],
      ["c", "todo", false],
    ]);
  });

  it("prepends new cards and keeps existing board order", () => {
    const s = syncSessions(state([card({ session: "old" })]), [
      { id: "old", status: "idle" },
      { id: "new", status: "idle" },
    ]);
    expect(s.cards.map((c) => c.session)).toEqual(["new", "old"]);
  });

  it("runs transitions for known sessions and drops vanished ones", () => {
    const s = syncSessions(state([card({ session: "a" }), card({ session: "gone" })]), [{ id: "a", status: "working" }]);
    expect(s.cards.map((c) => c.session)).toEqual(["a"]);
    expect(s.cards[0].lane).toBe("in_progress");
  });
});

describe("moveCard", () => {
  it("is manual, clears unread, and floats the card to the top of its lane", () => {
    const s = moveCard(state([card({ session: "a", unread: true }), card({ session: "b", lane: "done" })]), "a", "done");
    expect(s.cards[0]).toMatchObject({ session: "a", lane: "done", manual: true, unread: false });
    expect(laneCards(s, "done").map((c) => c.session)).toEqual(["a", "b"]);
  });

  it("ignores unknown sessions", () => {
    const before = state([card()]);
    expect(moveCard(before, "ghost", "done")).toBe(before);
  });
});

describe("setExpanded", () => {
  it("opening a card clears its unread badge; closing leaves cards untouched", () => {
    const opened = setExpanded(state([card({ unread: true })]), "s1");
    expect(opened.expanded).toBe("s1");
    expect(opened.cards[0].unread).toBe(false);
    const closed = setExpanded(opened, null);
    expect(closed.expanded).toBeNull();
  });
});

describe("countByLane", () => {
  it("tallies every lane", () => {
    const s = state([card(), card({ session: "s2", lane: "in_review" }), card({ session: "s3", lane: "in_review" })]);
    expect(countByLane(s)).toEqual({ todo: 1, in_progress: 0, in_review: 2, done: 0, canceled: 0 });
  });
});
