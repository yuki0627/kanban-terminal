import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NotifierEntry } from "./useNotifications";

const pubsubMock = vi.hoisted(() => ({
  subscribe: vi.fn(),
  onReconnect: vi.fn(),
}));

vi.mock("./usePubSub", () => ({
  usePubSub: () => pubsubMock,
}));

type NotificationsModule = typeof import("./useNotifications");
type Notifications = ReturnType<NotificationsModule["useNotifications"]>;
type PubSubHandler = (data: unknown) => void;

interface Subscription {
  channel: string;
  handler: PubSubHandler;
}

const subscriptions: Subscription[] = [];

function entry(overrides: Partial<NotifierEntry> & Pick<NotifierEntry, "id">): NotifierEntry {
  return {
    pluginPkg: "plugin-a",
    severity: "info",
    title: `Notification ${overrides.id}`,
    createdAt: "2026-07-07T00:00:00.000Z",
    ...overrides,
  };
}

function mockListFetch(active: NotifierEntry[] = []): void {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ active }),
  })) as unknown as typeof fetch;
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function mountNotifications(): Promise<Notifications> {
  const { useNotifications } = await import("./useNotifications");
  const notifications = useNotifications();
  await flushPromises();
  return notifications;
}

function emitNotificationEvent(event: unknown): void {
  expect(subscriptions).toHaveLength(1);
  expect(subscriptions[0]).toMatchObject({ channel: "notifications" });
  subscriptions[0]?.handler(event);
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  subscriptions.length = 0;
  pubsubMock.subscribe.mockImplementation((channel: string, handler: PubSubHandler) => {
    subscriptions.push({ channel, handler });
    return vi.fn();
  });
  pubsubMock.onReconnect.mockImplementation(() => vi.fn());
  mockListFetch();
});

describe("useNotifications", () => {
  it("applies pubsub upserts and removals without duplicates or missing-id side effects", async () => {
    const notifications = await mountNotifications();

    const firstAlpha = entry({ id: "alpha", severity: "info", title: "Alpha v1" });
    emitNotificationEvent({ type: "published", entry: firstAlpha });
    expect(notifications.active.value).toEqual([firstAlpha]);
    expect(notifications.count.value).toBe(1);

    const updatedAlpha = entry({ id: "alpha", severity: "urgent", title: "Alpha v2", body: "updated body" });
    emitNotificationEvent({ type: "published", entry: updatedAlpha });
    expect(notifications.active.value).toEqual([updatedAlpha]);
    expect(notifications.count.value).toBe(1);

    const beta = entry({ id: "beta", severity: "nudge", title: "Beta" });
    emitNotificationEvent({ type: "updated", entry: beta });
    expect(notifications.active.value).toEqual([updatedAlpha, beta]);
    expect(notifications.count.value).toBe(2);

    emitNotificationEvent({ type: "cleared", id: "missing" });
    expect(notifications.active.value).toEqual([updatedAlpha, beta]);
    expect(notifications.count.value).toBe(2);

    emitNotificationEvent({ type: "cleared", id: "alpha" });
    expect(notifications.active.value).toEqual([beta]);
    expect(notifications.count.value).toBe(1);

    emitNotificationEvent({ type: "cancelled", id: "missing" });
    expect(notifications.active.value).toEqual([beta]);
    expect(notifications.count.value).toBe(1);

    emitNotificationEvent({ type: "cancelled", id: "beta" });
    expect(notifications.active.value).toEqual([]);
    expect(notifications.count.value).toBe(0);
  });

  it("keeps topSeverity at the highest active severity", async () => {
    const notifications = await mountNotifications();

    expect(notifications.topSeverity.value).toBeNull();

    const info = entry({ id: "info", severity: "info" });
    emitNotificationEvent({ type: "published", entry: info });
    expect(notifications.topSeverity.value).toBe("info");

    const nudge = entry({ id: "nudge", severity: "nudge" });
    emitNotificationEvent({ type: "published", entry: nudge });
    expect(notifications.topSeverity.value).toBe("nudge");

    const urgent = entry({ id: "urgent", severity: "urgent" });
    emitNotificationEvent({ type: "published", entry: urgent });
    expect(notifications.topSeverity.value).toBe("urgent");

    emitNotificationEvent({ type: "cleared", id: "urgent" });
    expect(notifications.topSeverity.value).toBe("nudge");
  });

  it("sorts by severity descending, then createdAt descending", async () => {
    const infoNew = entry({ id: "info-new", severity: "info", createdAt: "2026-07-07T12:00:00.000Z" });
    const urgentOld = entry({ id: "urgent-old", severity: "urgent", createdAt: "2026-07-07T10:00:00.000Z" });
    const nudgeNewest = entry({ id: "nudge-newest", severity: "nudge", createdAt: "2026-07-07T13:00:00.000Z" });
    const urgentNew = entry({ id: "urgent-new", severity: "urgent", createdAt: "2026-07-07T11:00:00.000Z" });
    const infoOld = entry({ id: "info-old", severity: "info", createdAt: "2026-07-07T09:00:00.000Z" });
    mockListFetch([infoNew, urgentOld, nudgeNewest, urgentNew, infoOld]);

    const notifications = await mountNotifications();

    expect(notifications.sorted.value.map((item) => item.id)).toEqual(["urgent-new", "urgent-old", "nudge-newest", "info-new", "info-old"]);
    expect(notifications.sorted.value).toEqual([urgentNew, urgentOld, nudgeNewest, infoNew, infoOld]);
  });

  it("optimistically removes dismissed notifications and recovers from server failure", async () => {
    const alpha = entry({ id: "alpha id", severity: "urgent", title: "Alpha from initial fetch" });
    const beta = entry({ id: "beta", severity: "info", title: "Beta" });
    const recoveredAlpha = entry({ id: "alpha id", severity: "nudge", title: "Alpha from recovery fetch" });
    let listCalls = 0;
    let resolveClear: ((response: Response) => void) | undefined;
    const clearResponse = new Promise<Response>((resolve) => {
      resolveClear = resolve;
    });

    globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/notifications") {
        listCalls += 1;
        const active = listCalls === 1 ? [alpha, beta] : [recoveredAlpha, beta];
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ active }),
        } as Response);
      }
      if (url === "/api/notifications/alpha%20id/clear" && init?.method === "POST") {
        return clearResponse;
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    }) as unknown as typeof fetch;

    const notifications = await mountNotifications();
    expect(notifications.active.value).toEqual([alpha, beta]);

    const dismissPromise = notifications.dismiss("alpha id");
    expect(notifications.active.value).toEqual([beta]);
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/notifications/alpha%20id/clear", { method: "POST" });

    resolveClear?.({ ok: false, status: 500 } as Response);
    await dismissPromise;

    expect(listCalls).toBe(2);
    expect(notifications.active.value).toEqual([recoveredAlpha, beta]);
    expect(notifications.count.value).toBe(2);
  });

  it("keeps notification activation non-navigating", async () => {
    const { activate } = await mountNotifications();

    expect(activate()).toBe(false);
  });
});
