import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Express } from "express";
import path from "node:path";
import { openCommand, mountOpenDirRoute } from "./open-dir.js";

const mockSpawn = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, default: { ...actual, spawn: mockSpawn }, spawn: mockSpawn };
});

interface FakeRes {
  statusCode: number;
  payload: unknown;
  headersSent: boolean;
  status(code: number): FakeRes;
  json(body: unknown): FakeRes;
}

function makeRes(): FakeRes {
  return {
    statusCode: 200,
    payload: undefined,
    headersSent: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      this.headersSent = true;
      return this;
    },
  };
}

type RouteHandler = (req: { headers: { origin?: string }; body: unknown }, res: FakeRes) => unknown;

function captureHandler(isAllowedOrigin: (o?: string) => boolean): RouteHandler {
  let handler: RouteHandler | undefined;
  const app = {
    post(_path: string, h: RouteHandler) {
      handler = h;
    },
  } as unknown as Express;
  mountOpenDirRoute(app, { isAllowedOrigin });
  if (!handler) throw new Error("route was not mounted");
  return handler;
}

const allow = () => true;
const deny = () => false;

describe("openCommand", () => {
  it("uses `open` on macOS", () => {
    expect(openCommand("darwin")).toBe("open");
  });
  it("uses `explorer` on Windows", () => {
    expect(openCommand("win32")).toBe("explorer");
  });
  it("falls back to `xdg-open` elsewhere (Linux)", () => {
    expect(openCommand("linux")).toBe("xdg-open");
  });
});

describe("mountOpenDirRoute (POST /api/open-dir)", () => {
  beforeEach(() => {
    mockSpawn.mockReset();
    mockSpawn.mockReturnValue({ on: vi.fn(), unref: vi.fn() });
  });

  it("rejects a disallowed origin with 403", () => {
    const res = makeRes();
    captureHandler(deny)({ headers: { origin: "https://evil.example" }, body: { path: process.cwd() } }, res);
    expect(res.statusCode).toBe(403);
    expect(res.payload).toEqual({ error: "forbidden origin" });
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("requires an absolute path (400)", () => {
    const res = makeRes();
    captureHandler(allow)({ headers: {}, body: { path: "relative/dir" } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.payload).toEqual({ error: "absolute path required" });
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("404s a non-existent directory", () => {
    const res = makeRes();
    captureHandler(allow)({ headers: {}, body: { path: path.join(process.cwd(), "no-such-dir-xyz-123456") } }, res);
    expect(res.statusCode).toBe(404);
    expect(res.payload).toEqual({ error: "directory not found" });
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("400s a path that exists but isn't a directory", () => {
    const res = makeRes();
    captureHandler(allow)({ headers: {}, body: { path: path.join(process.cwd(), "package.json") } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.payload).toEqual({ error: "not a directory" });
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("returns 500 when spawning the file-manager opener throws", () => {
    mockSpawn.mockImplementationOnce(() => {
      throw new Error("spawn failed");
    });

    const res = makeRes();
    captureHandler(allow)({ headers: {}, body: { path: process.cwd() } }, res);

    expect(res.statusCode).toBe(500);
    expect(res.payload).toEqual({ error: "spawn failed" });
    expect(mockSpawn).toHaveBeenCalledWith(openCommand(process.platform), [process.cwd()], { detached: true, stdio: "ignore" });
  });
});
