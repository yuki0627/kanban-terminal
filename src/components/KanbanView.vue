<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import AppToolbar from "./AppToolbar.vue";
import SettingsModal from "./SettingsModal.vue";
import TerminalView from "./Terminal.vue";
import { useAppConfig } from "../composables/useAppConfig";
import { usePubSub } from "../composables/usePubSub";
import { reportActiveTerminals } from "../composables/useUnloadGuard";
import type { CellStatus } from "./activityStatus";
import {
  LANES,
  emptyKanbanState,
  initialKanbanState,
  moveCard,
  setExpanded,
  laneCards,
  updateCard,
  type KanbanCard,
  type KanbanState,
  type LaneId,
  type Project,
} from "./kanbanBoard";

const BOARD_CHANNEL = "board";
const NONE_COLOR = "#64748b";
const PROJECT_COLORS = ["#2563eb", "#16a34a", "#dc2626", "#9333ea", "#ea580c", "#0891b2", "#4f46e5", "#be123c"];

const state = ref<KanbanState>(emptyKanbanState());
const boardLoading = ref(true);
const boardError = ref<string | null>(null);

function boardPayload(s: KanbanState) {
  return { projects: s.projects, cards: s.cards };
}

async function loadBoard() {
  try {
    const res = await fetch("/api/board");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const expanded = state.value.expanded;
    state.value = { ...initialKanbanState(await res.json()), expanded };
    boardError.value = null;
  } catch (e) {
    boardError.value = e instanceof Error ? e.message : String(e);
  } finally {
    boardLoading.value = false;
  }
}

async function persistBoard(next: KanbanState) {
  state.value = next;
  try {
    const res = await fetch("/api/board", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(boardPayload(next)),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const expanded = state.value.expanded;
    state.value = { ...initialKanbanState(await res.json()), expanded };
    boardError.value = null;
  } catch (e) {
    boardError.value = e instanceof Error ? e.message : String(e);
  }
}

function commit(next: KanbanState) {
  void persistBoard(next);
}

function cardTitle(card: KanbanCard): string {
  return card.name || card.id.slice(0, 8);
}
function cardStatus(card: KanbanCard): CellStatus {
  return card.lastStatus;
}

// ---- projects sidebar ----
const sidebarCollapsed = ref(false);
const unassignedVisible = ref(true);
const sortedProjects = computed(() => [...state.value.projects].sort((a, b) => a.order - b.order));
const visibleProjectIds = computed(() => new Set(sortedProjects.value.filter((p) => p.sidebarVisible).map((p) => p.id)));

function projectFor(card: KanbanCard): Project | null {
  return card.projectId ? (state.value.projects.find((p) => p.id === card.projectId) ?? null) : null;
}
function projectVisible(card: KanbanCard): boolean {
  return card.projectId === null ? unassignedVisible.value : visibleProjectIds.value.has(card.projectId);
}
function visibleLaneCards(lane: LaneId): KanbanCard[] {
  return laneCards(state.value, lane).filter(projectVisible);
}
function projectCount(projectId: string | null): number {
  return state.value.cards.filter((c) => !c.archived && c.projectId === projectId).length;
}
function colorFor(index: number): string {
  return PROJECT_COLORS[index % PROJECT_COLORS.length];
}
function projectNameFromRoot(root: string): string {
  return root.split("/").filter(Boolean).at(-1) || root;
}
function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
async function addProject() {
  try {
    const res = await fetch("/api/pick-directory", { method: "POST", headers: { "content-type": "application/json" } });
    if (!res.ok) return;
    const data = (await res.json()) as { paths?: unknown };
    const root = Array.isArray(data.paths) && typeof data.paths[0] === "string" ? data.paths[0] : "";
    if (!root) return;
    const existing = state.value.projects.find((p) => p.root === root);
    if (existing) {
      commit({ ...state.value, projects: state.value.projects.map((p) => (p.id === existing.id ? { ...p, sidebarVisible: true } : p)) });
      return;
    }
    const project: Project = {
      id: newId("project"),
      root,
      name: projectNameFromRoot(root),
      color: colorFor(state.value.projects.length),
      sidebarVisible: true,
      order: state.value.projects.length,
    };
    commit({ ...state.value, projects: [...state.value.projects, project] });
  } catch {
    // Native picker unavailable or canceled.
  }
}
function toggleProject(projectId: string | null) {
  if (projectId === null) {
    unassignedVisible.value = !unassignedVisible.value;
    return;
  }
  commit({ ...state.value, projects: state.value.projects.map((p) => (p.id === projectId ? { ...p, sidebarVisible: !p.sidebarVisible } : p)) });
}

// ---- card creation ----
const creatingCard = ref<{ projectId: string | null; name: string; memo: string } | null>(null);
const { soundFile, loadConfig, saveSound, home } = useAppConfig();
function openCreate(projectId: string | null) {
  creatingCard.value = { projectId, name: "", memo: "" };
}
function createCard() {
  const draft = creatingCard.value;
  if (!draft) return;
  const project = draft.projectId ? (state.value.projects.find((p) => p.id === draft.projectId) ?? null) : null;
  const now = Date.now();
  const card: KanbanCard = {
    id: newId("card"),
    projectId: draft.projectId,
    name: draft.name.trim() || "New terminal",
    memo: draft.memo,
    lane: "todo",
    archived: false,
    unread: false,
    terminal: { sessionId: null, agentKind: "shell", cwd: project?.root ?? home.value ?? null },
    createdAt: now,
    updatedAt: now,
    manual: false,
    lastStatus: "idle",
  };
  creatingCard.value = null;
  commit({ ...state.value, cards: [card, ...state.value.cards], expanded: card.id });
}

// ---- expanded overlay ----
const connectKey = ref(0);
const terminalRef = ref<InstanceType<typeof TerminalView> | null>(null);
const activeCard = computed(() => state.value.cards.find((c) => c.id === state.value.expanded) ?? null);
const overlayOpen = computed(() => activeCard.value !== null);
const overlaySlot = computed(() => (activeCard.value ? `card-${activeCard.value.id}` : "card-none"));
const nameDraft = ref("");
const memoDraft = ref("");

watch(
  activeCard,
  (card) => {
    nameDraft.value = card?.name ?? "";
    memoDraft.value = card?.memo ?? "";
  },
  { immediate: true },
);

function openCard(cardId: string) {
  commit(setExpanded(state.value, cardId));
  connectKey.value++;
}
function closeOverlay() {
  state.value = setExpanded(state.value, null);
}
function onTerminalSession(sessionId: string) {
  const card = activeCard.value;
  if (!card) return;
  commit(updateCard(state.value, card.id, { terminal: { ...card.terminal, sessionId } }));
  void loadMemory();
}
function restartCardTerminal() {
  const card = activeCard.value;
  if (!card) return;
  terminalRef.value?.terminate();
  commit(updateCard(state.value, card.id, { terminal: { ...card.terminal, sessionId: null } }));
  connectKey.value++;
}
function saveCardText() {
  const card = activeCard.value;
  if (!card) return;
  commit(updateCard(state.value, card.id, { name: nameDraft.value.trim() || card.name, memo: memoDraft.value }));
}

watch(overlayOpen, (open) => reportActiveTerminals("kanban", open ? 1 : 0), { immediate: true });

// ---- memory visibility ----
const memoryBySession = ref(new Map<string, number>());
const totalRssKb = ref(0);
function formatMemory(kb: number): string {
  if (kb <= 0) return "0 MB";
  return `${Math.max(1, Math.round(kb / 1024))} MB`;
}
function cardMemory(card: KanbanCard): string | null {
  const sessionId = card.terminal.sessionId;
  if (!sessionId) return null;
  const kb = memoryBySession.value.get(sessionId) ?? 0;
  return kb > 0 ? formatMemory(kb) : null;
}
async function loadMemory() {
  try {
    const res = await fetch("/api/memory");
    if (!res.ok) return;
    const data = (await res.json()) as { totalRssKb?: number; sessions?: Array<{ sessionId: string; rssKb: number }> };
    totalRssKb.value = typeof data.totalRssKb === "number" ? data.totalRssKb : 0;
    memoryBySession.value = new Map((data.sessions ?? []).map((item) => [item.sessionId, item.rssKb]));
  } catch {
    // best-effort metric
  }
}

// ---- drag & drop ----
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
  if (dragging.value) commit(moveCard(state.value, dragging.value, lane));
  onDragEnd();
}

const showSettings = ref(false);
const pubsub = usePubSub();
let unsubscribeBoard: (() => void) | undefined;
let offReconnect: (() => void) | undefined;
let memoryTimer: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  loadConfig();
  loadBoard();
  loadMemory();
  memoryTimer = setInterval(loadMemory, 10_000);
  unsubscribeBoard = pubsub.subscribe(BOARD_CHANNEL, () => void loadBoard());
  offReconnect = pubsub.onReconnect(() => void loadBoard());
});
onUnmounted(() => {
  unsubscribeBoard?.();
  offReconnect?.();
  if (memoryTimer) clearInterval(memoryTimer);
});
</script>

<template>
  <div class="shell">
    <AppToolbar @settings="showSettings = true" />
    <div class="memory-strip" aria-label="Terminal memory">Memory {{ formatMemory(totalRssKb) }}</div>
    <div v-if="boardError" class="board-error" role="alert">{{ boardError }}</div>
    <div v-else-if="boardLoading" class="board-error">Loading...</div>
    <div class="workspace">
      <aside :class="['projects', { collapsed: sidebarCollapsed }]" aria-label="Projects">
        <button
          type="button"
          class="collapse-btn"
          :title="sidebarCollapsed ? 'Expand projects' : 'Collapse projects'"
          @click="sidebarCollapsed = !sidebarCollapsed"
        >
          <span class="material-symbols-outlined">{{ sidebarCollapsed ? "chevron_right" : "chevron_left" }}</span>
        </button>
        <template v-if="!sidebarCollapsed">
          <div class="projects-head">
            <span class="projects-title">Projects</span>
            <button type="button" class="icon-btn" title="Add project" aria-label="Add project" @click="addProject">
              <span class="material-symbols-outlined">create_new_folder</span>
            </button>
          </div>
          <button type="button" class="project-row" :class="{ off: !unassignedVisible }" @click="toggleProject(null)">
            <span class="project-swatch" :style="{ background: NONE_COLOR }" />
            <span class="project-name">Projectなし</span>
            <span class="project-count">{{ projectCount(null) }}</span>
            <span class="project-add" title="Add card" aria-label="Add card" @click.stop="openCreate(null)">
              <span class="material-symbols-outlined">add</span>
            </span>
          </button>
          <button
            v-for="project in sortedProjects"
            :key="project.id"
            type="button"
            class="project-row"
            :class="{ off: !project.sidebarVisible }"
            @click="toggleProject(project.id)"
          >
            <span class="project-swatch" :style="{ background: project.color }" />
            <span class="project-name">{{ project.name }}</span>
            <span class="project-count">{{ projectCount(project.id) }}</span>
            <span class="project-add" title="Add card" aria-label="Add card" @click.stop="openCreate(project.id)">
              <span class="material-symbols-outlined">add</span>
            </span>
          </button>
        </template>
      </aside>

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
            <span class="lane-count">{{ visibleLaneCards(lane.id).length }}</span>
          </header>
          <div class="lane-cards">
            <article
              v-for="c in visibleLaneCards(lane.id)"
              :key="c.id"
              class="card"
              :class="[`st-${cardStatus(c)}`, { unread: c.unread, dragging: dragging === c.id }]"
              :style="{ borderLeftColor: projectFor(c)?.color ?? NONE_COLOR }"
              draggable="true"
              tabindex="0"
              :title="cardTitle(c)"
              @dragstart="onDragStart(c.id, $event)"
              @dragend="onDragEnd"
              @click="openCard(c.id)"
              @keydown.enter="openCard(c.id)"
            >
              <span class="card-dot" aria-hidden="true" />
              <span class="card-title">{{ cardTitle(c) }}</span>
              <span v-if="cardMemory(c)" class="card-memory">{{ cardMemory(c) }}</span>
              <span v-if="c.unread" class="card-unread" title="Moved while closed">●</span>
            </article>
          </div>
        </section>
      </div>
    </div>

    <div v-if="overlayOpen && activeCard" class="overlay" @click.self="closeOverlay">
      <div class="overlay-card">
        <header class="overlay-header" :style="{ borderTopColor: projectFor(activeCard)?.color ?? NONE_COLOR }">
          <input v-model="nameDraft" class="overlay-title-input" aria-label="Card name" @change="saveCardText" />
          <button
            v-if="activeCard.terminal.sessionId"
            type="button"
            class="overlay-close"
            title="Restart terminal"
            aria-label="Restart terminal"
            @click="restartCardTerminal"
          >
            <span class="material-symbols-outlined">restart_alt</span>
          </button>
          <button type="button" class="overlay-close" title="Close card" aria-label="Close card" @click="closeOverlay">
            <span class="material-symbols-outlined">close</span>
          </button>
        </header>
        <div class="overlay-body">
          <textarea v-model="memoDraft" class="memo" placeholder="Memo" aria-label="Memo" @change="saveCardText" />
          <div class="terminal-panel">
            <TerminalView
              ref="terminalRef"
              :key="overlaySlot"
              class="overlay-terminal"
              :persist-key="overlaySlot"
              :session-id="activeCard.terminal.sessionId"
              :cwd="activeCard.terminal.cwd"
              card-terminal
              :card-id="activeCard.id"
              :launcher="{ index: 0 }"
              :connect-key="connectKey"
              @session="onTerminalSession"
            />
          </div>
        </div>
      </div>
    </div>

    <div v-if="creatingCard" class="overlay create-overlay" @click.self="creatingCard = null">
      <div class="create-card" role="dialog" aria-modal="true" aria-label="Create card">
        <header class="create-head">
          <span>Create card</span>
          <button type="button" class="overlay-close" title="Close" aria-label="Close" @click="creatingCard = null">
            <span class="material-symbols-outlined">close</span>
          </button>
        </header>
        <input v-model="creatingCard.name" class="field" placeholder="Card name" aria-label="Card name" @keydown.enter="createCard" />
        <textarea v-model="creatingCard.memo" class="field memo-field" placeholder="Memo" aria-label="Memo" />
        <div class="create-actions">
          <button type="button" class="btn" @click="creatingCard = null">Cancel</button>
          <button type="button" class="btn btn-primary" @click="createCard">Create</button>
        </div>
      </div>
    </div>

    <SettingsModal v-if="showSettings" :sound-file="soundFile" @update-sound="saveSound" @close="showSettings = false" />
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
.memory-strip {
  flex: 0 0 auto;
  padding: 5px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-base);
  color: var(--text-muted);
  font-family: ui-monospace, monospace;
  font-size: 11px;
}

.workspace {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

.projects {
  position: relative;
  flex: 0 0 230px;
  min-width: 0;
  padding: 10px 8px;
  border-right: 1px solid var(--border);
  background: var(--bg-panel);
  overflow-y: auto;
  font-family: system-ui, sans-serif;
}
.projects.collapsed {
  flex-basis: 42px;
  padding: 8px 6px;
  overflow: hidden;
}
.collapse-btn,
.icon-btn,
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
.collapse-btn:hover,
.icon-btn:hover,
.overlay-close:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.projects.collapsed .collapse-btn {
  width: 30px;
}
.projects-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  padding-left: 4px;
}
.projects-title {
  flex: 1;
  color: var(--text);
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.project-row {
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr) auto 24px;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 34px;
  padding: 0 6px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
}
.project-row:hover {
  background: var(--bg-hover);
}
.project-row.off {
  opacity: 0.45;
}
.project-swatch {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
.project-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
  font-size: 13px;
}
.project-count {
  font-family: ui-monospace, monospace;
  font-size: 11px;
  color: var(--text-muted);
}
.project-add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 5px;
  color: var(--text-muted);
}
.project-add:hover {
  background: var(--bg-base);
  color: var(--text);
}
.project-add .material-symbols-outlined,
.collapse-btn .material-symbols-outlined,
.icon-btn .material-symbols-outlined,
.overlay-close .material-symbols-outlined {
  font-size: 18px;
}

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
  border-radius: 8px;
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
.lane-cards {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-left-width: 4px;
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
.card-memory {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-family: ui-monospace, monospace;
  font-size: 11px;
}
.card-unread {
  color: var(--accent);
  font-size: 10px;
  flex: 0 0 auto;
}
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
  border-radius: 8px;
  overflow: hidden;
}
.overlay-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-top: 4px solid transparent;
  border-bottom: 1px solid var(--border);
  font-family: system-ui, sans-serif;
}
.overlay-title-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  outline: none;
}
.overlay-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-rows: minmax(92px, 22%) minmax(0, 1fr);
}
.memo {
  width: 100%;
  min-height: 0;
  padding: 10px 12px;
  border: none;
  border-bottom: 1px solid var(--border);
  resize: none;
  outline: none;
  background: var(--bg-base);
  color: var(--text);
  font-family: system-ui, sans-serif;
  font-size: 13px;
}
.terminal-panel {
  min-height: 0;
  display: flex;
}
.overlay-terminal {
  flex: 1;
  min-height: 0;
}
.create-card {
  width: min(460px, 92vw);
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  font-family: system-ui, sans-serif;
}
.create-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 14px;
  font-weight: 600;
}
.field {
  width: 100%;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel);
  color: var(--text);
  outline: none;
}
.memo-field {
  min-height: 90px;
  resize: vertical;
}
.create-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.btn {
  padding: 7px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel);
  color: var(--text);
  cursor: pointer;
}
.btn-primary {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--on-accent);
}
</style>
