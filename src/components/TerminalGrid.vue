<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import TerminalCell from "./TerminalCell.vue";
import { MAX_CELLS, dims, trackStyle, type Layout } from "./gridLayout";

// Zooming interface: the grid is the base view; expanding a cell grows it to fill
// the area and shrinks the others to zero — animated by transitioning the grid
// track sizes (Mac-like zoom). All cells stay MOUNTED while zoomed, so their
// terminals keep running. The layout (cell arrangement) is chosen in the toolbar.
const props = defineProps<{ layout: Layout }>();

const cellCount = computed(() => dims(props.layout).cellCount);
// Render only the visible cells; the persisted arrays are kept at MAX_CELLS so a
// session/cwd survives switching to a smaller layout and back.
const cells = computed(() => Array.from({ length: cellCount.value }, (_, i) => i));

// The active workspace dir, shown in each cell header (server global for now;
// per-cell dirs are a follow-up).
const cwd = ref<string | null>(null);
onMounted(async () => {
  try {
    const res = await fetch("/api/config");
    if (res.ok) cwd.value = (await res.json()).cwd ?? null;
  } catch {
    // header just omits the dir if config can't be fetched
  }
});

// Persisted so a page reload restores the open terminals and the zoom state.
const STORE_KEY = "grid_state_v1";
// Session ids are UUIDs. Drop anything else from a stale/tampered localStorage so
// a cell never mounts with an invalid id (which the server rejects, leaving the
// terminal reconnecting forever).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function loadState(): { sessions: (string | null)[]; expanded: number | null } {
  const sessions = Array<string | null>(MAX_CELLS).fill(null);
  let expanded: number | null = null;
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || "");
    for (let i = 0; i < MAX_CELLS; i++) {
      const v = parsed?.sessions?.[i];
      if (typeof v === "string" && UUID_RE.test(v)) sessions[i] = v;
    }
    const e = parsed?.expanded;
    if (typeof e === "number" && e >= 0 && e < MAX_CELLS) expanded = e;
  } catch {
    // no/invalid state — defaults
  }
  return { sessions, expanded };
}

const initial = loadState();
const cellSessions = ref<(string | null)[]>(initial.sessions);
const expanded = ref<number | null>(initial.expanded);

watch([cellSessions, expanded], () => localStorage.setItem(STORE_KEY, JSON.stringify({ sessions: cellSessions.value, expanded: expanded.value })), {
  deep: true,
});

// A zoomed cell that's no longer visible (layout shrank) can't stay zoomed.
watch(cellCount, (n) => {
  if (expanded.value !== null && expanded.value >= n) expanded.value = null;
});

function toggleExpand(i: number) {
  expanded.value = expanded.value === i ? null : i;
}

function setSession(i: number, id: string | null) {
  cellSessions.value[i] = id;
  if (id === null && expanded.value === i) expanded.value = null; // a closed cell can't stay zoomed
}

const gridStyle = computed(() => trackStyle(props.layout, expanded.value));
</script>

<template>
  <div class="grid" :style="gridStyle">
    <TerminalCell
      v-for="i in cells"
      :key="i"
      :expanded="expanded === i"
      :initial-session-id="cellSessions[i]"
      :cwd="cwd"
      @toggle-expand="toggleExpand(i)"
      @session="(id) => setSession(i, id)"
      @close="() => setSession(i, null)"
    />
  </div>
</template>

<style scoped>
.grid {
  height: 100%;
  width: 100%;
  display: grid;
  padding: 6px;
  background: #0f0f1e;
  box-sizing: border-box;
  /* Mac-like zoom: animate the track sizes (and gap) as a cell expands/restores. */
  transition:
    grid-template-columns 0.24s cubic-bezier(0.22, 1, 0.36, 1),
    grid-template-rows 0.24s cubic-bezier(0.22, 1, 0.36, 1),
    gap 0.24s cubic-bezier(0.22, 1, 0.36, 1);
}
</style>
