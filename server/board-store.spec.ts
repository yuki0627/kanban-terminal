import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadBoard, saveBoard, sanitizeBoard } from "./board-store.js";

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
          terminal: { sessionId: "s1", agentKind: "shell", cwd: "/work/app" },
          lastStatus: "done",
        },
        { id: "c2", projectId: "missing", lane: "nope" },
      ],
    });
    expect(board.projects).toHaveLength(1);
    expect(board.projects[0]).toMatchObject({ id: "p1", root: "/work/app", name: "App", sidebarVisible: false });
    expect(board.cards[0]).toMatchObject({ id: "c1", projectId: "p1", lane: "in_review", archived: true });
    expect(board.cards[1]).toMatchObject({ id: "c2", projectId: null, lane: "todo" });
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
});
