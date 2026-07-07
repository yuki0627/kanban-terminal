import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Express } from "express";
import { pickFileCommand, pickDirectoryCommand, parsePickerOutput, mountPickFileRoute, mountPickDirectoryRoute } from "./pick-file.js";

const mockSpawn = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, default: { ...actual, spawn: mockSpawn }, spawn: mockSpawn };
});

interface FakeRes {
  statusCode: number;
  payload: unknown;
  payloads: unknown[];
  headersSent: boolean;
  status(code: number): FakeRes;
  json(body: unknown): FakeRes;
}

function makeRes(): FakeRes {
  return {
    statusCode: 200,
    payload: undefined,
    payloads: [],
    headersSent: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      this.payloads.push(body);
      this.headersSent = true;
      return this;
    },
  };
}

type RouteHandler = (req: { headers: { origin?: string }; body?: unknown }, res: FakeRes) => unknown;

type MountRoute = (app: Express, options: { isAllowedOrigin: (origin?: string) => boolean }) => void;

function captureHandler(mountRoute: MountRoute, isAllowedOrigin: (o?: string) => boolean): RouteHandler {
  let handler: RouteHandler | undefined;
  const app = {
    post(_path: string, h: RouteHandler) {
      handler = h;
    },
  } as unknown as Express;
  mountRoute(app, { isAllowedOrigin });
  if (!handler) throw new Error("route was not mounted");
  return handler;
}

function makeChild() {
  const handlers = new Map<string, (error?: Error) => void>();
  return {
    handlers,
    stdout: { on: vi.fn() },
    on: vi.fn((event: string, handler: (error?: Error) => void) => {
      handlers.set(event, handler);
      return undefined;
    }),
  };
}

const allow = () => true;
const deny = () => false;

describe("pickFileCommand", () => {
  it("uses osascript on macOS", () => {
    expect(pickFileCommand("darwin").cmd).toBe("osascript");
  });
  it("uses powershell on Windows", () => {
    expect(pickFileCommand("win32").cmd).toBe("powershell");
  });
  it("falls back to zenity elsewhere (Linux)", () => {
    expect(pickFileCommand("linux").cmd).toBe("zenity");
  });
});

describe("pickDirectoryCommand", () => {
  it("uses folder selection on macOS", () => {
    const cmd = pickDirectoryCommand("darwin");
    expect(cmd.cmd).toBe("osascript");
    expect(cmd.args.join(" ")).toContain("choose folder");
  });
});

describe("parsePickerOutput", () => {
  it("splits newline-separated absolute paths", () => {
    expect(parsePickerOutput("/a/b.txt\n/c/d.txt")).toEqual(["/a/b.txt", "/c/d.txt"]);
  });
  it("trims and drops blank lines", () => {
    expect(parsePickerOutput("  /a.txt  \n\n")).toEqual(["/a.txt"]);
  });
  it("handles CRLF output", () => {
    expect(parsePickerOutput("/a.txt\r\n/b.txt\r\n")).toEqual(["/a.txt", "/b.txt"]);
  });
  it("rejects relative or junk lines (e.g. a cancel message)", () => {
    expect(parsePickerOutput("not a path\nrelative/p.txt")).toEqual([]);
  });
  it("returns empty for empty output (user canceled)", () => {
    expect(parsePickerOutput("")).toEqual([]);
  });
});

describe("mountPickFileRoute (POST /api/pick-file)", () => {
  beforeEach(() => {
    mockSpawn.mockReset();
  });

  it("rejects a disallowed origin with 403", () => {
    const res = makeRes();
    captureHandler(mountPickFileRoute, deny)({ headers: { origin: "https://evil.example" } }, res);
    expect(res.statusCode).toBe(403);
    expect(res.payload).toEqual({ error: "forbidden origin" });
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("sends one 500 response when the child emits error and then close", () => {
    const child = makeChild();
    mockSpawn.mockReturnValueOnce(child);

    const res = makeRes();
    captureHandler(mountPickFileRoute, allow)({ headers: {} }, res);
    child.handlers.get("error")?.(new Error("ENOENT"));
    child.handlers.get("close")?.();

    expect(res.statusCode).toBe(500);
    expect(res.payload).toEqual({ error: "file dialog unavailable: ENOENT" });
    expect(res.payloads).toEqual([{ error: "file dialog unavailable: ENOENT" }]);
    expect(mockSpawn).toHaveBeenCalledWith(pickFileCommand(process.platform).cmd, pickFileCommand(process.platform).args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
  });
});

describe("mountPickDirectoryRoute (POST /api/pick-directory)", () => {
  beforeEach(() => {
    mockSpawn.mockReset();
  });

  it("rejects a disallowed origin with 403", () => {
    const res = makeRes();
    captureHandler(mountPickDirectoryRoute, deny)({ headers: { origin: "https://evil.example" } }, res);
    expect(res.statusCode).toBe(403);
    expect(res.payload).toEqual({ error: "forbidden origin" });
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("sends one 500 response when the child emits error and then close", () => {
    const child = makeChild();
    mockSpawn.mockReturnValueOnce(child);

    const res = makeRes();
    captureHandler(mountPickDirectoryRoute, allow)({ headers: {} }, res);
    child.handlers.get("error")?.(new Error("ENOENT"));
    child.handlers.get("close")?.();

    expect(res.statusCode).toBe(500);
    expect(res.payload).toEqual({ error: "directory dialog unavailable: ENOENT" });
    expect(res.payloads).toEqual([{ error: "directory dialog unavailable: ENOENT" }]);
    expect(mockSpawn).toHaveBeenCalledWith(pickDirectoryCommand(process.platform).cmd, pickDirectoryCommand(process.platform).args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
  });
});
