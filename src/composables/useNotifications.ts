// Toolbar notification state: a module-level singleton that fetches the active set
// once, then keeps it live by subscribing to the notifier pubsub channel. The bell
// (NotificationBell.vue) reads count / topSeverity / sorted and calls dismiss /
// activate.
//
// Server-only notifier types are not imported here; the small value types are
// mirrored locally, matching the wire shape the server's /api/notifications +
// NotifierEvent emit.
import { ref, computed } from "vue";
import { usePubSub } from "./usePubSub";

// Must match server/backends/notifier.ts NOTIFIER_CHANNEL.
const NOTIFIER_CHANNEL = "notifications";

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

// Discriminated union mirroring the server's NotifierEvent.
type NotifierEvent =
  { type: "published"; entry: NotifierEntry } | { type: "updated"; entry: NotifierEntry } | { type: "cleared"; id: string } | { type: "cancelled"; id: string };

const SEVERITY_RANK: Record<NotifierSeverity, number> = { info: 0, nudge: 1, urgent: 2 };

const active = ref<NotifierEntry[]>([]);
let initialized = false;

function upsert(entry: NotifierEntry): void {
  const idx = active.value.findIndex((existing) => existing.id === entry.id);
  if (idx === -1) active.value.push(entry);
  else active.value.splice(idx, 1, entry);
}

function remove(id: string): void {
  const idx = active.value.findIndex((existing) => existing.id === id);
  if (idx !== -1) active.value.splice(idx, 1);
}

function applyEvent(event: NotifierEvent): void {
  switch (event.type) {
    case "published":
    case "updated":
      upsert(event.entry);
      break;
    case "cleared":
    case "cancelled":
      remove(event.id);
      break;
  }
}

async function fetchActive(): Promise<void> {
  try {
    const res = await fetch("/api/notifications");
    if (!res.ok) {
      console.error(`[notifications] list failed: HTTP ${res.status}`);
      return;
    }
    const data = (await res.json()) as { active?: NotifierEntry[] };
    active.value = Array.isArray(data.active) ? data.active : [];
  } catch (err) {
    console.error("[notifications] list failed", err);
  }
}

function ensureInit(): void {
  if (initialized) return;
  initialized = true;
  const pubsub = usePubSub();
  pubsub.subscribe(NOTIFIER_CHANNEL, (data) => applyEvent(data as NotifierEvent));
  // pubsub only replays room membership on reconnect, not the events missed while
  // disconnected — re-fetch the authoritative list so the bell can't go stale.
  pubsub.onReconnect(() => void fetchActive());
  void fetchActive();
}

export function useNotifications() {
  ensureInit();

  const count = computed(() => active.value.length);

  const topSeverity = computed<NotifierSeverity | null>(() => {
    let top: NotifierSeverity | null = null;
    for (const entry of active.value) {
      if (top === null || SEVERITY_RANK[entry.severity] > SEVERITY_RANK[top]) top = entry.severity;
    }
    return top;
  });

  // Worst-severity first, then newest first within a severity.
  const sorted = computed(() =>
    [...active.value].sort((left, right) => {
      const bySeverity = SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity];
      if (bySeverity !== 0) return bySeverity;
      return right.createdAt.localeCompare(left.createdAt);
    }),
  );

  /** Dismiss (clear) a notification: the ✕ action. Optimistically drops it, then
   *  asks the server to clear; on failure we resync from the server. */
  async function dismiss(id: string): Promise<void> {
    remove(id);
    try {
      const res = await fetch(`/api/notifications/${encodeURIComponent(id)}/clear`, { method: "POST" });
      if (!res.ok) {
        console.error(`[notifications] clear failed: HTTP ${res.status}`);
        await fetchActive();
      }
    } catch (err) {
      console.error("[notifications] clear failed", err);
      await fetchActive();
    }
  }

  /** Row click hook retained for callers that still check activatability. No
   *  notification currently navigates. */
  function activate(): boolean {
    return false;
  }

  return { active, count, topSeverity, sorted, dismiss, activate };
}
