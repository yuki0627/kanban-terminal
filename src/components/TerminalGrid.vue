<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import TerminalCell from "./TerminalCell.vue";
import { MAX_CELLS, dims, trackStyle, type Layout } from "./gridLayout";
import type { CwdPreset } from "./presets";

// Zooming interface: the grid is the base view; expanding a cell switches to a
// filmstrip layout — the zoomed cell fills the top, the other cells line up in a
// horizontally-scrolling strip below (click any cell's ⤢ to swap which is zoomed).
// Cells stay MOUNTED across the switch (moved with <Teleport>, not re-created), so
// their terminals keep running instead of reconnecting. The layout (cell
// arrangement) is chosen in the toolbar. `defaultCwd` prefills the launch form;
// `presets` are the quick-pick dirs; `home` anchors the cell header path on ~.
const props = defineProps<{ layout: Layout; defaultCwd: string | null; presets: CwdPreset[]; home: string | null }>();

const cellCount = computed(() => dims(props.layout).cellCount);
// Render only the visible cells; the persisted arrays are kept at MAX_CELLS so a
// session/cwd survives switching to a smaller layout and back.
const cells = computed(() => Array.from({ length: cellCount.value }, (_, i) => i));

// Persisted so a page reload restores the open terminals and the zoom state.
const STORE_KEY = "grid_state_v1";
// Session ids are UUIDs. Drop anything else from a stale/tampered localStorage so
// a cell never mounts with an invalid id (which the server rejects, leaving the
// terminal reconnecting forever).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function loadState(): { sessions: (string | null)[]; cwds: (string | null)[]; expanded: number | null } {
  const sessions = Array<string | null>(MAX_CELLS).fill(null);
  const cwds = Array<string | null>(MAX_CELLS).fill(null);
  let expanded: number | null = null;
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || "");
    for (let i = 0; i < MAX_CELLS; i++) {
      const v = parsed?.sessions?.[i];
      if (typeof v === "string" && UUID_RE.test(v)) sessions[i] = v;
      const c = parsed?.cwds?.[i];
      if (typeof c === "string") cwds[i] = c;
    }
    const e = parsed?.expanded;
    if (typeof e === "number" && e >= 0 && e < MAX_CELLS) expanded = e;
  } catch {
    // no/invalid state — defaults
  }
  return { sessions, cwds, expanded };
}

const initial = loadState();
const cellSessions = ref<(string | null)[]>(initial.sessions);
const cellCwds = ref<(string | null)[]>(initial.cwds);
const expanded = ref<number | null>(initial.expanded);

watch(
  [cellSessions, cellCwds, expanded],
  () => localStorage.setItem(STORE_KEY, JSON.stringify({ sessions: cellSessions.value, cwds: cellCwds.value, expanded: expanded.value })),
  { deep: true },
);

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

function onClose(i: number) {
  cellSessions.value[i] = null;
  cellCwds.value[i] = null;
  if (expanded.value === i) expanded.value = null;
}

// The grid (non-zoomed) always uses full equal tracks; the zoom layout is handled
// by the filmstrip scaffold below, not by collapsing grid tracks.
const gridStyle = computed(() => trackStyle(props.layout, null));

// Teleport targets for the filmstrip. They must be in the document before a cell
// relocates, so hold off until mounted (covers a page reload that restores a zoom).
const zoomMain = ref<HTMLElement | null>(null);
const zoomStrip = ref<HTMLElement | null>(null);
const mounted = ref(false);
onMounted(() => (mounted.value = true));

const zoomed = computed(() => expanded.value !== null && mounted.value);
const cellTarget = (i: number) => (expanded.value === i ? zoomMain.value : zoomStrip.value);
</script>

<template>
  <div class="stage" :class="{ zoomed }">
    <div ref="zoomMain" class="zoom-main" />
    <div ref="zoomStrip" class="zoom-strip" />
    <div class="grid" :style="gridStyle">
      <Teleport v-for="i in cells" :key="i" :to="cellTarget(i)" :disabled="!zoomed">
        <TerminalCell
          :expanded="expanded === i"
          :initial-session-id="cellSessions[i]"
          :initial-cwd="cellCwds[i]"
          :default-cwd="defaultCwd"
          :presets="presets"
          :home="home"
          @toggle-expand="toggleExpand(i)"
          @session="(id) => setSession(i, id)"
          @cwd="(c) => (cellCwds[i] = c)"
          @close="() => onClose(i)"
        />
      </Teleport>
    </div>
  </div>
</template>

<style scoped>
.stage {
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  background: #0f0f1e;
}

.grid {
  flex: 1;
  min-height: 0;
  display: grid;
  padding: 6px;
  box-sizing: border-box;
}

/* Inert until a cell is zoomed. */
.zoom-main,
.zoom-strip {
  display: none;
}

.stage.zoomed .grid {
  display: none;
}

/* Filmstrip: the zoomed cell fills the top. */
.stage.zoomed .zoom-main {
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
  padding: 6px 6px 0;
}
.zoom-main > * {
  flex: 1;
  min-width: 0;
  min-height: 0;
}

/* The other cells line up below and scroll horizontally when they overflow. */
.stage.zoomed .zoom-strip {
  display: flex;
  flex: 0 0 auto;
  gap: 6px;
  height: 150px;
  padding: 6px;
  overflow-x: auto;
  overflow-y: hidden;
}
.zoom-strip > * {
  flex: 0 0 260px;
  height: 100%;
  min-width: 0;
}
</style>
