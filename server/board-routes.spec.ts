import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Express } from "express";
import { mountBoardRoutes } from "./board-routes.js";

const mockLoadBoard = vi.hoisted(() => vi.fn());
const mockMarkCardRead = vi.hoisted(() => vi.fn());
const mockSaveBoard = vi.hoisted(() => vi.fn());
const mockSanitizeBoard = vi.hoisted(() => vi.fn());

vi.mock("./board-store.js", () => ({
  loadBoard: mockLoadBoard,
  markCardRead: mockMarkCardRead,
  saveBoard: mockSaveBoard,
  sanitizeBoard: mockSanitizeBoard,
}));

interface FakeRes {
  statusCode: number;
  payload: unknown;
  status(code: number): FakeRes;
  json(body: unknown): FakeRes;
}

function makeRes(): FakeRes {
  return {
    statusCode: 200,
    payload: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    },
  };
}

type RouteHandler = (req: { headers: { origin?: string }; body?: unknown; params?: { id?: string } }, res: FakeRes) => unknown;

function captureHandlers(isAllowedOrigin: (o?: string) => boolean): { putBoard: RouteHandler; postRead: RouteHandler } {
  let putBoard: RouteHandler | undefined;
  let postRead: RouteHandler | undefined;
  const app = {
    get() {
      return undefined;
    },
    put(path: string, h: RouteHandler) {
      if (path === "/api/board") putBoard = h;
    },
    post(path: string, h: RouteHandler) {
      if (path === "/api/board/card/:id/read") postRead = h;
    },
  } as unknown as Express;

  mountBoardRoutes(app, { isAllowedOrigin, pubsub: { publish: vi.fn() } });
  if (!putBoard || !postRead) throw new Error("routes were not mounted");
  return { putBoard, postRead };
}

const allow = () => true;
const deny = () => false;
const board = { projects: [], cards: [] };

describe("mountBoardRoutes origin checks", () => {
  beforeEach(() => {
    mockLoadBoard.mockReset();
    mockMarkCardRead.mockReset();
    mockSaveBoard.mockReset();
    mockSanitizeBoard.mockReset();
    mockLoadBoard.mockReturnValue(board);
    mockMarkCardRead.mockReturnValue(board);
    mockSaveBoard.mockReturnValue(true);
    mockSanitizeBoard.mockReturnValue(board);
  });

  it("rejects PUT /api/board from a disallowed origin with 403", () => {
    const res = makeRes();
    captureHandlers(deny).putBoard({ headers: { origin: "https://evil.example" }, body: {} }, res);
    expect(res.statusCode).toBe(403);
    expect(res.payload).toEqual({ error: "forbidden origin" });
    expect(mockSanitizeBoard).not.toHaveBeenCalled();
    expect(mockSaveBoard).not.toHaveBeenCalled();
  });

  it("rejects POST /api/board/card/:id/read from a disallowed origin with 403", () => {
    const res = makeRes();
    captureHandlers(deny).postRead({ headers: { origin: "https://evil.example" }, params: { id: "c1" } }, res);
    expect(res.statusCode).toBe(403);
    expect(res.payload).toEqual({ error: "forbidden origin" });
    expect(mockLoadBoard).not.toHaveBeenCalled();
    expect(mockSaveBoard).not.toHaveBeenCalled();
  });

  it("allows PUT /api/board from a localhost origin", () => {
    const res = makeRes();
    captureHandlers(allow).putBoard({ headers: { origin: "http://localhost:5173" }, body: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual(board);
    expect(mockSaveBoard).toHaveBeenCalledWith(board);
  });

  it("allows POST /api/board/card/:id/read when the origin header is absent", () => {
    const res = makeRes();
    captureHandlers(allow).postRead({ headers: {}, params: { id: "c1" } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual(board);
    expect(mockMarkCardRead).toHaveBeenCalledWith(board, "c1");
    expect(mockSaveBoard).toHaveBeenCalledWith(board);
  });
});
