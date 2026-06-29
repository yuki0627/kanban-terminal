// Drives the favicon off the authoritative session list (useSessions): it's seeded
// from /api/sessions on mount, refetched on every "sessions" pub-sub push, and
// resynced on reconnect — so the icon mirrors current truth and is never left stale
// by a missed event. Hidden background workers are excluded (they don't demand the
// user's attention, matching the sidebar's unread semantics).
import { computed, type Ref } from "vue";
import { useDynamicFavicon } from "./useDynamicFavicon";
import type { Session } from "./useSessions";

export type FaviconState = "idle" | "working" | "attention";

interface Activity {
  working: boolean;
  waiting: boolean;
}

// attention(waiting) wins over working wins over idle — matching the grid cell's own
// status priority, so the tab icon agrees with the cell border.
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

export function useFaviconState(sessions: Ref<Session[]>): void {
  const color = computed(() => STATE_COLOR[deriveFaviconState(sessions.value.filter((s) => !s.hidden))]);
  useDynamicFavicon(color);
}
