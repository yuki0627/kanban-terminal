<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import AppToolbar from "./AppToolbar.vue";
import SettingsModal from "./SettingsModal.vue";
import TerminalView from "./Terminal.vue";
import { useSessions } from "../composables/useSessions";
import { useAppConfig } from "../composables/useAppConfig";
import { reportActiveTerminals } from "../composables/useUnloadGuard";
import { release } from "../composables/useTerminalConnections";
import { activityStatus, type CellStatus } from "./gridTabs";
import { LANES, KANBAN_STATE_KEY, initialKanbanState, syncSessions, moveCard, setExpanded, laneCards, type KanbanState, type LaneId } from "./kanbanBoard";

// The kanban board view, shown at /kanban. Every Claude session is a card; the
// "sessions" activity stream (via useSessions) moves cards between lanes through
// the pure transforms in kanbanBoard.ts. Cards render as chips only — the live
// terminal mounts solely inside the expanded overlay, because each mounted
// terminal is a real PTY + socket + xterm canvas, and FitAddon needs a laid-out
// element anyway. Collapsed cards therefore cost nothing.

const state = ref<KanbanState>(initialKanbanState(localStorage.getItem(KANBAN_STATE_KEY)));
watch(state, () => localStorage.setItem(KANBAN_STATE_KEY, JSON.stringify(state.value)), { deep: true });

// The server's authoritative session list; every "sessions" pub/sub push refetches
// it, which re-runs this watcher and drives the board's automatic lane moves.
// NEVER reconcile before the first load lands (or against a failed fetch):
// `sessions` starts as [], and syncSessions would read that as "every session
// vanished" and wipe the persisted board, then re-add everything as fresh
// To Do cards once the real list arrives.
const { sessions, loading, error } = useSessions();
watch(
  [sessions, loading, error],
  ([list, isLoading, loadError]) => {
    if (isLoading || loadError) return;
    state.value = syncSessions(
      state.value,
      list.map((s) => ({ id: s.id, status: activityStatus(s.working, s.waiting, s.event) })),
    );
  },
  { immediate: true, deep: true },
);

const titleById = computed(() => new Map(sessions.value.map((s) => [s.id, s.title])));
const statusById = computed(() => new Map<string, CellStatus>(sessions.value.map((s) => [s.id, activityStatus(s.working, s.waiting, s.event)])));
const cardTitle = (id: string) => titleById.value.get(id) || id.slice(0, 8);
const cardStatus = (id: string): CellStatus => statusById.value.get(id) ?? "idle";

// ---- expanded overlay (the one live terminal) ----
// `creating` opens the overlay on a FRESH session (sessionId null): the server
// mints an id, the "sessions" push adds its card, and we adopt it as expanded so
// closing/reopening targets the right card. The terminal keeps its original
// "kanban-new" slot for the overlay's lifetime (a persistKey swap would remount
// and supersede itself); the slot is released on close, and a later reopen
// attaches a fresh slot to the same session (tmux/live PTY makes that seamless).
const creating = ref(false);
const createdId = ref<string | null>(null);
const connectKey = ref(0);
const NEW_SLOT = "kanban-new";

const overlayOpen = computed(() => creating.value || state.value.expanded !== null);
const overlaySlot = computed(() => (creating.value ? NEW_SLOT : `kanban-${state.value.expanded}`));
const overlaySession = computed(() => (creating.value ? createdId.value : state.value.expanded));
const overlayTitle = computed(() => (overlaySession.value ? cardTitle(overlaySession.value) : "New session"));

function openCard(id: string) {
  if (creating.value) closeOverlay();
  state.value = setExpanded(state.value, id);
  connectKey.value++;
}

function newCard() {
  if (overlayOpen.value) closeOverlay();
  creating.value = true;
  createdId.value = null;
  connectKey.value++;
}

// The fresh terminal reports its server-minted session id: remember it as this
// card's identity (its card appears via the next "sessions" push) but keep the
// overlay on the "kanban-new" slot until it closes.
function onNewSession(id: string) {
  createdId.value = id;
  state.value = setExpanded(state.value, id);
}

function closeOverlay() {
  if (creating.value) {
    // Drop the one-off creation slot; the session (if one started) lives on
    // server-side and reattaches through its own kanban-<id> slot next open.
    release(NEW_SLOT);
    creating.value = false;
    createdId.value = null;
  }
  state.value = setExpanded(state.value, null);
}

// Feed the tab-close guard while the overlay holds a live terminal. Collapsed
// cards keep their PTYs alive server-side (tmux), so they don't need the guard.
watch(overlayOpen, (open) => reportActiveTerminals("kanban", open ? 1 : 0), { immediate: true });

// ---- drag & drop (manual lane moves) ----
const dragging = ref<string | null>(null);
const dropLane = ref<LaneId | null>(null);

function onDragStart(id: string, e: DragEvent) {
  dragging.value = id;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  }
}
function onDragEnd() {
  dragging.value = null;
  dropLane.value = null;
}
function onDrop(lane: LaneId) {
  if (dragging.value) state.value = moveCard(state.value, dragging.value, lane);
  onDragEnd();
}

// Settings (theme + sound), same modal as the other views.
const { soundFile, launchers, loadConfig, saveSound, saveLaunchers } = useAppConfig();
const showSettings = ref(false);
onMounted(loadConfig);
</script>

<template>
  <div class="shell">
    <AppToolbar @settings="showSettings = true" />
    <div v-if="error" class="board-error" role="alert">{{ error }}</div>
    <div v-else-if="loading" class="board-error">Loading…</div>
    <div class="board" role="list" aria-label="Kanban board">
      <section
        v-for="lane in LANES"
        :key="lane.id"
        class="lane"
        :class="{ 'drop-target': dropLane === lane.id }"
        role="listitem"
        :aria-label="lane.title"
        @dragover.prevent="dropLane = lane.id"
        @dragleave="dropLane === lane.id && (dropLane = null)"
        @drop.prevent="onDrop(lane.id)"
      >
        <header class="lane-header">
          <span class="lane-title">{{ lane.title }}</span>
          <span class="lane-count">{{ laneCards(state, lane.id).length }}</span>
          <button v-if="lane.id === 'todo'" type="button" class="lane-add" title="New session" aria-label="New session" @click="newCard">
            <span class="material-symbols-outlined">add</span>
          </button>
        </header>
        <div class="lane-cards">
          <article
            v-for="c in laneCards(state, lane.id)"
            :key="c.session"
            class="card"
            :class="[`st-${cardStatus(c.session)}`, { unread: c.unread, dragging: dragging === c.session }]"
            draggable="true"
            tabindex="0"
            :title="cardTitle(c.session)"
            @dragstart="onDragStart(c.session, $event)"
            @dragend="onDragEnd"
            @click="openCard(c.session)"
            @keydown.enter="openCard(c.session)"
          >
            <span class="card-dot" aria-hidden="true" />
            <span class="card-title">{{ cardTitle(c.session) }}</span>
            <span v-if="c.unread" class="card-unread" title="Moved while closed">●</span>
          </article>
        </div>
      </section>
    </div>

    <!-- The one live terminal: an overlay over the board, closed by ✕ or Esc is
         left to the terminal (never a close key — it belongs to claude). -->
    <div v-if="overlayOpen" class="overlay" @click.self="closeOverlay">
      <div class="overlay-card">
        <header class="overlay-header">
          <span class="overlay-title">{{ overlayTitle }}</span>
          <button type="button" class="overlay-close" title="Close card (terminal keeps running)" aria-label="Close card" @click="closeOverlay">
            <span class="material-symbols-outlined">close</span>
          </button>
        </header>
        <TerminalView
          :key="overlaySlot"
          class="overlay-terminal"
          :persist-key="overlaySlot"
          :session-id="creating ? null : state.expanded"
          :connect-key="connectKey"
          @session="onNewSession"
        />
      </div>
    </div>

    <SettingsModal
      v-if="showSettings"
      :sound-file="soundFile"
      :launchers="launchers"
      @update-sound="saveSound"
      @update-launchers="saveLaunchers"
      @close="showSettings = false"
    />
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
}

.board-error {
  padding: 8px 16px;
  color: var(--text-muted);
  font-family: system-ui, sans-serif;
  font-size: 13px;
}

/* Five equal lanes side by side, each scrolling its own cards. */
.board {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 10px;
  padding: 12px;
  overflow-x: auto;
}
.lane {
  flex: 1 1 0;
  min-width: 180px;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  min-height: 0;
}
.lane.drop-target {
  border-color: var(--accent);
  background: var(--bg-hover);
}
.lane-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  font-family: system-ui, sans-serif;
}
.lane-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.lane-count {
  font-family: ui-monospace, monospace;
  font-size: 11px;
  color: var(--text-muted);
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 1px 7px;
}
.lane-add {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}
.lane-add:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.lane-add .material-symbols-outlined {
  font-size: 18px;
}
.lane-cards {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* A collapsed card: status dot + title. No terminal is mounted here. */
.card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
  font-family: system-ui, sans-serif;
  user-select: none;
}
.card:hover {
  background: var(--bg-hover);
}
.card.dragging {
  opacity: 0.5;
}
.card-title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.card.unread .card-title {
  font-weight: 700;
}
.card-unread {
  color: var(--accent);
  font-size: 10px;
  flex: 0 0 auto;
}
/* Status dot: amber = blocked (needs you), accent = done (review), pulsing dim =
   working, hollow = idle — the grid's color language. */
.card-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex: 0 0 auto;
  border: 1.5px solid var(--text-muted);
  background: transparent;
}
.card.st-working .card-dot {
  border-color: transparent;
  background: var(--text-muted);
  animation: kanban-pulse 1.2s ease-in-out infinite;
}
.card.st-blocked .card-dot {
  border-color: transparent;
  background: var(--amber);
}
.card.st-done .card-dot {
  border-color: transparent;
  background: var(--accent);
}
@keyframes kanban-pulse {
  50% {
    opacity: 0.3;
  }
}

/* Expanded card: a centered overlay hosting THE live terminal. */
.overlay {
  position: fixed;
  inset: 0;
  z-index: 30;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4vh 4vw;
}
.overlay-card {
  display: flex;
  flex-direction: column;
  width: min(1100px, 100%);
  height: 100%;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
}
.overlay-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  font-family: system-ui, sans-serif;
}
.overlay-title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.overlay-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}
.overlay-close:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.overlay-close .material-symbols-outlined {
  font-size: 18px;
}
.overlay-terminal {
  flex: 1;
  min-height: 0;
}
</style>
