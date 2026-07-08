import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyCardStatus, loadBoard, markCardRead, saveBoard, sanitizeBoard } from "./board-store.js";

describe("sanitizeBoard", () => {
  it("keeps valid projects and cards while dropping unsafe project roots", () => {
    const board = sanitizeBoard({
      projects: [
        { id: "p1", root: "/work/app", name: "App", color: "#123456", sidebarVisible: false, order: 2 },
        { id: "bad", root: "relative" },
      ],
      cards: [
        {
          id: "c1",
          projectId: "p1",
          name: "Task",
          memo: "notes",
          lane: "in_review",
          archived: true,
          terminal: { sessionId: "s1", agentKind: "shell", cwd: "/work/app", agentSessionId: "a1" },
          overlay: { x: 10, y: 20, width: 900, height: 640 },
          lastStatus: "done",
        },
        { id: "c2", projectId: "missing", lane: "nope" },
      ],
    });
    expect(board.projects).toHaveLength(1);
    expect(board.projects[0]).toMatchObject({ id: "p1", root: "/work/app", name: "App", sidebarVisible: false });
    expect(board.cards[0]).toMatchObject({
      id: "c1",
      projectId: "p1",
      lane: "in_review",
      archived: true,
      terminal: { agentSessionId: "a1" },
      overlay: { x: 10, y: 20, width: 900, height: 640 },
    });
    expect(board.cards[1]).toMatchObject({ id: "c2", projectId: null, lane: "todo" });
  });

  it("deduplicates projects by root, sorts them by order, and keeps the first card per id", () => {
    const board = sanitizeBoard({
      projects: [
        { id: "later", root: "/work/later", name: "Later", order: 20 },
        { id: "middle", root: "/work/middle", name: "Middle", order: 10 },
        { id: "duplicate-root", root: "/work/middle", name: "Duplicate root", order: 0 },
        { id: "first", root: "/work/first", name: "First", order: -5 },
      ],
      cards: [
        { id: "dup", projectId: "middle", name: "Original", lane: "todo" },
        { id: "keep", projectId: "duplicate-root", name: "Unlinked", lane: "done" },
        { id: "dup", projectId: "first", name: "Duplicate", lane: "canceled" },
      ],
    });

    expect(board.projects.map((project) => ({ id: project.id, root: project.root, order: project.order }))).toEqual([
      { id: "first", root: "/work/first", order: -5 },
      { id: "middle", root: "/work/middle", order: 10 },
      { id: "later", root: "/work/later", order: 20 },
    ]);
    expect(board.cards.map((card) => ({ id: card.id, projectId: card.projectId, name: card.name, lane: card.lane }))).toEqual([
      { id: "dup", projectId: "middle", name: "Original", lane: "todo" },
      { id: "keep", projectId: null, name: "Unlinked", lane: "done" },
    ]);
  });
});

describe("board persistence", () => {
  it("round-trips through JSON", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "board-"));
    const file = path.join(dir, "board.json");
    const board = sanitizeBoard({ projects: [{ id: "p1", root: "/work/app" }], cards: [{ id: "c1", name: "Task" }] });
    expect(saveBoard(board, file)).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8")).cards[0].id).toBe("c1");
    expect(loadBoard(file)).toEqual(board);
  });

  it("returns false when the board file cannot be written", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "board-"));
    const asFile = path.join(dir, "afile");
    writeFileSync(asFile, "x");

    expect(saveBoard(sanitizeBoard({ cards: [{ id: "c1" }] }), path.join(asFile, "sub", "board.json"))).toBe(false);

    rmSync(dir, { recursive: true, force: true });
  });
});

describe("applyCardStatus", () => {
  it("moves by edge signals and keeps idle from becoming a destination", () => {
    let board = sanitizeBoard({ cards: [{ id: "c1", lane: "todo", lastStatus: "idle" }] });
    board = applyCardStatus(board, "c1", "working");
    expect(board.cards[0]).toMatchObject({ lane: "in_progress", lastStatus: "working", unread: true });
    board = applyCardStatus(board, "c1", "done");
    expect(board.cards[0]).toMatchObject({ lane: "in_review", lastStatus: "done", unread: true });
    board = applyCardStatus(board, "c1", "idle");
    expect(board.cards[0]).toMatchObject({ lane: "in_review", lastStatus: "idle" });
  });

  it("protects manually finished cards except on work start", () => {
    const waiting = applyCardStatus(sanitizeBoard({ cards: [{ id: "c1", lane: "done", manual: true }] }), "c1", "blocked");
    expect(waiting.cards[0]).toMatchObject({ lane: "done", manual: true });
    const started = applyCardStatus(waiting, "c1", "working");
    expect(started.cards[0]).toMatchObject({ lane: "in_progress", manual: false });
  });

  it("does not mark a viewed card unread on automatic moves", () => {
    const board = sanitizeBoard({ cards: [{ id: "c1", lane: "todo", lastStatus: "idle" }] });
    const next = applyCardStatus(board, "c1", "working", { viewed: true });
    expect(next.cards[0]).toMatchObject({ lane: "in_progress", unread: false });
  });

  it("ignores status signals for an archived card (no lane move, no unread)", () => {
    const board = sanitizeBoard({
      cards: [{ id: "c1", lane: "in_review", archived: true, lastStatus: "done", unread: false }],
    });
    const next = applyCardStatus(board, "c1", "working");
    expect(next.cards[0]).toMatchObject({ lane: "in_review", archived: true, unread: false, lastStatus: "done" });
  });
});

describe("markCardRead", () => {
  it("persists an unread clear without changing other cards", () => {
    const board = sanitizeBoard({
      cards: [
        { id: "c1", unread: true },
        { id: "c2", unread: true },
      ],
    });
    const next = markCardRead(board, "c1");
    expect(next.cards[0]).toMatchObject({ id: "c1", unread: false });
    expect(next.cards[1]).toMatchObject({ id: "c2", unread: true });
  });
});
