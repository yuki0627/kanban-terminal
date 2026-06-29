// Drives the favicon off LIVE activity across every session — the same global
// "sessions" pub-sub stream the attention beep uses — so the icon reacts to
// background and other-directory grid sessions, not just the on-screen one.
import { computed, onUnmounted, ref } from "vue";
import { usePubSub } from "./usePubSub";
import { useDynamicFavicon } from "./useDynamicFavicon";

export type FaviconState = "idle" | "working" | "attention";

interface Activity {
  working: boolean;
  waiting: boolean;
}
interface ActivityMsg {
  id: string;
  working?: boolean;
  waiting?: boolean;
  event?: string | null;
}
const isRecord = (d: unknown): d is Record<string, unknown> => typeof d === "object" && d !== null;
const isActivityMsg = (d: unknown): d is ActivityMsg => isRecord(d) && "id" in d;

// attention(waiting) wins over working wins over idle — matching the grid cell's
// own status priority, so the tab icon agrees with the cell border.
export function deriveFaviconState(activities: Iterable<Activity>): FaviconState {
  let working = false;
  for (const a of activities) {
    if (a.waiting) return "attention";
    if (a.working) working = true;
  }
  return working ? "working" : "idle";
}

const STATE_COLOR: Record<FaviconState, string> = {
  idle: "#8a8aa0", // slate — nothing happening
  working: "#4a8cff", // blue — Claude is thinking
  attention: "#e0a030", // amber — needs you
};

export function useFaviconState(): void {
  const activity = ref(new Map<string, Activity>());

  // Seed (and re-seed on reconnect) from the authoritative session list: pub-sub only
  // delivers transitions, so sessions already active on load — or events missed while
  // the socket was down — would otherwise never register and leave the icon stale.
  // /api/sessions is the default project's list; other-dir grid sessions still arrive
  // live on the stream below.
  async function seedFromServer(): Promise<void> {
    try {
      const res = await fetch("/api/sessions");
      if (!res.ok) return;
      const data: unknown = await res.json();
      const list = isRecord(data) && Array.isArray(data.sessions) ? data.sessions : [];
      const next = new Map(activity.value);
      for (const s of list) {
        if (isRecord(s) && typeof s.id === "string") next.set(s.id, { working: s.working === true, waiting: s.waiting === true });
      }
      activity.value = next;
    } catch {
      // best-effort — live events still drive the favicon
    }
  }

  const { subscribe, onReconnect } = usePubSub();
  const unsubscribe = subscribe("sessions", (d) => {
    if (!isActivityMsg(d)) return;
    const next = new Map(activity.value);
    if (d.event === "closed") next.delete(d.id);
    else next.set(d.id, { working: d.working ?? false, waiting: d.waiting ?? false });
    activity.value = next;
  });
  const offReconnect = onReconnect(seedFromServer);
  seedFromServer();
  onUnmounted(() => {
    unsubscribe();
    offReconnect();
  });

  const color = computed(() => STATE_COLOR[deriveFaviconState(activity.value.values())]);
  useDynamicFavicon(color);
}
