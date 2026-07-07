// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Express, Request, Response } from "express";
import { initNotifier, mountNotificationRoutes, NOTIFIER_CHANNEL, publishNotification } from "./notifier.js";

interface Published {
  channel: string;
  data: unknown;
}
type RouteHandler = (req: Request, res: Response) => void | Promise<void>;

let events: Published[] = [];
let workspace: string;
let routes: Map<string, RouteHandler>;
const tempDirs: string[] = [];

function activeFile(): string {
  return path.join(workspace, "data", "notifier", "active.json");
}

function historyFile(): string {
  return path.join(workspace, "data", "notifier", "history.json");
}

beforeEach(async () => {
  workspace = mkdtempSync(path.join(tmpdir(), "mt-notif-"));
  tempDirs.push(workspace);
  events = [];
  await initNotifier({
    workspace,
    pubsub: { publish: (channel, data) => events.push({ channel, data }) },
  });

  routes = new Map();
  const app = {
    get(route: string, handler: RouteHandler) {
      routes.set(`GET ${route}`, handler);
      return app;
    },
    post(route: string, handler: RouteHandler) {
      routes.set(`POST ${route}`, handler);
      return app;
    },
  };
  mountNotificationRoutes(app as unknown as Express);
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function request(method: "GET" | "POST", route: string, params: Record<string, string> = {}): Promise<{ status: number; body: unknown }> {
  const handler = routes.get(`${method} ${route}`);
  expect(handler).toBeDefined();
  let status = 200;
  let body: unknown;
  const res = {
    status(code: number) {
      status = code;
      return res;
    },
    json(payload: unknown) {
      body = payload;
      return res;
    },
    end() {
      return res;
    },
  };

  await handler?.({ params } as Request, res as unknown as Response);
  return { status, body };
}

describe("notifier backend", () => {
  it("publishes → lists → fans out an event → persists active.json → clears", async () => {
    const { id } = await publishNotification({ pluginPkg: "test", severity: "nudge", title: "Heads up", body: "something happened" });

    // Fan-out: a "published" event landed on the notifier channel.
    expect(events).toHaveLength(1);
    expect(events[0].channel).toBe(NOTIFIER_CHANNEL);
    expect(events[0].data).toMatchObject({ type: "published", entry: { id, title: "Heads up" } });

    // REST list returns the active entry.
    const listRes = await request("GET", "/api/notifications");
    expect(listRes.status).toBe(200);
    const { active } = listRes.body as { active: Array<{ id: string; title: string }> };
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ id, title: "Heads up" });

    // Persisted to the shared workspace file.
    expect(existsSync(activeFile())).toBe(true);
    const onDisk = JSON.parse(readFileSync(activeFile(), "utf8")) as Array<{ id: string }>;
    expect(onDisk.map((entry) => entry.id)).toContain(id);

    // Dismiss via REST → 204, removed from the active list, "cleared" event fired.
    const clearRes = await request("POST", "/api/notifications/:id/clear", { id });
    expect(clearRes.status).toBe(204);

    const afterRes = await request("GET", "/api/notifications");
    expect((afterRes.body as { active: unknown[] }).active).toHaveLength(0);
    expect(events.some((event) => (event.data as { type?: string }).type === "cleared")).toBe(true);

    const historyRes = await request("GET", "/api/notifications/history");
    expect(historyRes.status).toBe(200);
    expect(historyRes.body as { history: Array<{ id: string; title: string }> }).toEqual({
      history: [{ id, pluginPkg: "test", severity: "nudge", title: "Heads up", body: "something happened", createdAt: expect.any(String) }],
    });
  });

  it("returns 204 without persisting or publishing when clearing a missing id", async () => {
    const { id } = await publishNotification({ pluginPkg: "test", severity: "info", title: "Keep me" });
    rmSync(historyFile());
    mkdirSync(historyFile());

    const clearRes = await request("POST", "/api/notifications/:id/clear", { id: "missing" });
    expect(clearRes.status).toBe(204);
    expect(events).toHaveLength(1);
    expect(events[0].data).toMatchObject({ type: "published", entry: { id, title: "Keep me" } });

    const listRes = await request("GET", "/api/notifications");
    expect(listRes.body as { active: Array<{ id: string; title: string }> }).toEqual({
      active: [{ id, pluginPkg: "test", severity: "info", title: "Keep me", createdAt: expect.any(String) }],
    });
  });

  it("keeps only the 200 most recent cleared notifications in history", async () => {
    const entries = [];
    for (let i = 0; i < 205; i += 1) {
      entries.push(await publishNotification({ pluginPkg: "test", severity: "nudge", title: `Entry ${i}` }));
    }

    for (const entry of entries) {
      const clearRes = await request("POST", "/api/notifications/:id/clear", { id: entry.id });
      expect(clearRes.status).toBe(204);
    }

    const historyRes = await request("GET", "/api/notifications/history");
    expect(historyRes.status).toBe(200);
    const { history } = historyRes.body as { history: Array<{ id: string; title: string }> };
    expect(history).toHaveLength(200);
    expect(history[0]).toMatchObject({ id: entries[204].id, title: "Entry 204" });
    expect(history[199]).toMatchObject({ id: entries[5].id, title: "Entry 5" });
    expect(history.some((entry) => entry.id === entries[4].id)).toBe(false);
  });

  it("filters invalid entries from active and history files on init", async () => {
    mkdirSync(path.dirname(activeFile()), { recursive: true });
    writeFileSync(
      activeFile(),
      JSON.stringify([
        { id: "active-valid", pluginPkg: "pkg", severity: "urgent", title: "Valid active", createdAt: "2026-07-07T00:00:00.000Z" },
        { id: "active-bad-severity", pluginPkg: "pkg", severity: "bad", title: "Bad severity", createdAt: "2026-07-07T00:00:00.000Z" },
        { id: "active-missing-title", pluginPkg: "pkg", severity: "info", createdAt: "2026-07-07T00:00:00.000Z" },
        null,
      ]),
    );
    writeFileSync(
      historyFile(),
      JSON.stringify([
        { id: "history-valid", pluginPkg: "pkg", severity: "info", title: "Valid history", createdAt: "2026-07-07T00:00:00.000Z" },
        { id: 5, pluginPkg: "pkg", severity: "nudge", title: "Bad id", createdAt: "2026-07-07T00:00:00.000Z" },
      ]),
    );
    await initNotifier({
      workspace,
      pubsub: { publish: (channel, data) => events.push({ channel, data }) },
    });

    const activeRes = await request("GET", "/api/notifications");
    expect(activeRes.body as { active: Array<{ id: string; title: string }> }).toEqual({
      active: [{ id: "active-valid", pluginPkg: "pkg", severity: "urgent", title: "Valid active", createdAt: "2026-07-07T00:00:00.000Z" }],
    });

    const historyRes = await request("GET", "/api/notifications/history");
    expect(historyRes.body as { history: Array<{ id: string; title: string }> }).toEqual({
      history: [{ id: "history-valid", pluginPkg: "pkg", severity: "info", title: "Valid history", createdAt: "2026-07-07T00:00:00.000Z" }],
    });
  });
});
