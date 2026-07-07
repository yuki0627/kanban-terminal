import { describe, expect, it } from "vitest";
import type { Express } from "express";
import { mountConfigRoutes } from "./config-routes.js";

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

type RouteHandler = (req: { headers: { origin?: string }; body?: unknown }, res: FakeRes) => unknown;

function capturePostConfigHandler(isAllowedOrigin: (o?: string) => boolean): RouteHandler {
  let handler: RouteHandler | undefined;
  const app = {
    get() {
      return undefined;
    },
    post(_path: string, h: RouteHandler) {
      handler = h;
    },
  } as unknown as Express;
  mountConfigRoutes(app, process.cwd(), { isAllowedOrigin });
  if (!handler) throw new Error("route was not mounted");
  return handler;
}

const allow = () => true;
const deny = () => false;

describe("mountConfigRoutes (POST /api/config)", () => {
  it("rejects a disallowed origin with 403", () => {
    const res = makeRes();
    capturePostConfigHandler(deny)({ headers: { origin: "https://evil.example" }, body: { cwdPresets: "not-array" } }, res);
    expect(res.statusCode).toBe(403);
    expect(res.payload).toEqual({ error: "forbidden origin" });
  });

  it("continues to validation for an allowed localhost origin", () => {
    const res = makeRes();
    capturePostConfigHandler(allow)({ headers: { origin: "http://localhost:5173" }, body: { cwdPresets: "not-array" } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.payload).toEqual({ error: "cwdPresets must be an array" });
  });

  it("continues to validation when the origin header is absent", () => {
    const res = makeRes();
    capturePostConfigHandler(allow)({ headers: {}, body: { launchers: "not-array" } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.payload).toEqual({ error: "launchers must be an array" });
  });
});
