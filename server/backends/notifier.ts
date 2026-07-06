import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";
import type { createPubSub } from "../pubsub.js";

type PubSub = ReturnType<typeof createPubSub>;

export const NOTIFIER_CHANNEL = "notifications";

export type NotifierSeverity = "info" | "nudge" | "urgent";
export type NotifierLifecycle = "fyi" | "action";

export interface NotifierEntry {
  id: string;
  pluginPkg: string;
  severity: NotifierSeverity;
  lifecycle?: NotifierLifecycle;
  title: string;
  body?: string;
  pluginData?: unknown;
  createdAt: string;
}

let active: NotifierEntry[] = [];
let history: NotifierEntry[] = [];
let activeFile: string | null = null;
let historyFile: string | null = null;
let pubsub: PubSub | null = null;

async function readList(file: string): Promise<NotifierEntry[]> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"));
    return Array.isArray(parsed) ? parsed.filter(isNotifierEntry) : [];
  } catch {
    return [];
  }
}

async function writeList(file: string, list: readonly NotifierEntry[]): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(list, null, 2)}\n`, "utf8");
}

function isNotifierEntry(value: unknown): value is NotifierEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    typeof entry.pluginPkg === "string" &&
    typeof entry.title === "string" &&
    typeof entry.createdAt === "string" &&
    (entry.severity === "info" || entry.severity === "nudge" || entry.severity === "urgent")
  );
}

async function persist(): Promise<void> {
  if (activeFile) await writeList(activeFile, active);
  if (historyFile) await writeList(historyFile, history);
}

export async function publishNotification(input: {
  pluginPkg: string;
  severity: NotifierSeverity;
  lifecycle?: NotifierLifecycle;
  title: string;
  body?: string;
  pluginData?: unknown;
}): Promise<NotifierEntry> {
  const entry: NotifierEntry = {
    id: randomUUID(),
    pluginPkg: input.pluginPkg,
    severity: input.severity,
    lifecycle: input.lifecycle,
    title: input.title,
    body: input.body,
    pluginData: input.pluginData,
    createdAt: new Date().toISOString(),
  };
  active = [entry, ...active.filter((existing) => existing.id !== entry.id)];
  pubsub?.publish(NOTIFIER_CHANNEL, { type: "published", entry });
  await persist();
  return entry;
}

export async function initNotifier(deps: { workspace: string; pubsub: PubSub | null }): Promise<void> {
  const dir = path.join(deps.workspace, "data", "notifier");
  activeFile = path.join(dir, "active.json");
  historyFile = path.join(dir, "history.json");
  pubsub = deps.pubsub;
  active = await readList(activeFile);
  history = await readList(historyFile);
}

export function mountNotificationRoutes(app: Express): void {
  app.get("/api/notifications", (_req: Request, res: Response) => {
    res.json({ active });
  });

  app.get("/api/notifications/history", (_req: Request, res: Response) => {
    res.json({ history });
  });

  app.post("/api/notifications/:id/clear", async (req: Request<{ id: string }>, res: Response) => {
    const idx = active.findIndex((entry) => entry.id === req.params.id);
    if (idx !== -1) {
      const [cleared] = active.splice(idx, 1);
      history = [cleared, ...history.filter((entry) => entry.id !== cleared.id)].slice(0, 200);
      pubsub?.publish(NOTIFIER_CHANNEL, { type: "cleared", id: cleared.id });
      await persist();
    }
    res.status(204).end();
  });
}
