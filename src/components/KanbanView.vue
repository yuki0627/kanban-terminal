<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import type { StyleValue } from "vue";
import AppToolbar from "./AppToolbar.vue";
import SettingsModal from "./SettingsModal.vue";
import TerminalView from "./Terminal.vue";
import { useAppConfig } from "../composables/useAppConfig";
import { usePubSub } from "../composables/usePubSub";
import { reportActiveTerminals } from "../composables/useUnloadGuard";
import { useCardSize } from "../composables/useCardSize";
import { memoHasOverflow } from "./cardMemo";
import {
  LANES,
  emptyKanbanState,
  initialKanbanState,
  moveCard,
  setExpanded,
  laneCards,
  archivedCards,
  archiveCards,
  restoreCard,
  updateCard,
  updateOverlayFrame,
  updateMemoPanel,
  type KanbanCard,
  type KanbanState,
  type LaneId,
  type MemoPanel,
  type OverlayFrame,
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

async function markCardRead(cardId: string) {
  try {
    const previousSessionId = state.value.cards.find((c) => c.id === cardId)?.terminal.sessionId ?? null;
    const res = await fetch(`/api/board/card/${encodeURIComponent(cardId)}/read`, { method: "POST" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const expanded = state.value.expanded;
    state.value = { ...initialKanbanState(await res.json()), expanded };
    const nextSessionId = state.value.cards.find((c) => c.id === cardId)?.terminal.sessionId ?? null;
    if (expanded === cardId && nextSessionId && nextSessionId !== previousSessionId) connectKey.value++;
    boardError.value = null;
  } catch (e) {
    boardError.value = e instanceof Error ? e.message : String(e);
  }
}

async function markCardClosed(cardId: string) {
  try {
    await fetch(`/api/board/card/${encodeURIComponent(cardId)}/close`, { method: "POST" });
  } catch {
    // best-effort view-state cleanup; board persistence is unaffected.
  }
}

function cardTitle(card: KanbanCard): string {
  return card.name || card.id.slice(0, 8);
}
function dotState(card: KanbanCard): "working" | "unread" | "read" {
  if (card.lastStatus === "working") return "working";
  if (card.unread) return "unread";
  return "read";
}

// Board-wide card density (small / medium / large), bound onto each lane's card
// list; the toolbar segment control writes it. See useCardSize.
const { cardSize } = useCardSize();

// ---- projects sidebar ----
const sidebarCollapsed = ref(false);
const collapsedLanes = ref<Set<LaneId>>(new Set());
function toggleLaneCollapse(lane: LaneId) {
  const next = new Set(collapsedLanes.value);
  if (next.has(lane)) next.delete(lane);
  else next.add(lane);
  collapsedLanes.value = next;
}
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
function laneHasUnread(lane: LaneId): boolean {
  return visibleLaneCards(lane).some((c) => c.unread);
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
async function createCard() {
  const draft = creatingCard.value;
  if (!draft) return;
  const project = draft.projectId ? (state.value.projects.find((p) => p.id === draft.projectId) ?? null) : null;
  try {
    const res = await fetch("/api/board/cards", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: draft.projectId,
        name: draft.name,
        memo: draft.memo,
        cwd: project?.root ?? home.value ?? null,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = initialKanbanState({ projects: state.value.projects, cards: [await res.json()] });
    const card = parsed.cards[0];
    if (!card?.terminal.sessionId) throw new Error("Card terminal session was not assigned");
    creatingCard.value = null;
    state.value = { ...state.value, cards: [card, ...state.value.cards.filter((c) => c.id !== card.id)], expanded: card.id };
    boardError.value = null;
  } catch (e) {
    boardError.value = e instanceof Error ? e.message : String(e);
  }
}

// ---- expanded overlay ----
const connectKey = ref(0);
const terminalRef = ref<InstanceType<typeof TerminalView> | null>(null);
const activeCard = computed(() => state.value.cards.find((c) => c.id === state.value.expanded) ?? null);
const overlayOpen = computed(() => activeCard.value !== null);
const overlaySlot = computed(() => (activeCard.value ? `card-${activeCard.value.id}` : "card-none"));
const nameDraft = ref("");
const memoDraft = ref("");
const overlayFrameDraft = ref<OverlayFrame | null>(null);

watch(
  activeCard,
  (card) => {
    nameDraft.value = card?.name ?? "";
    memoDraft.value = card?.memo ?? "";
  },
  { immediate: true },
);

function openCard(cardId: string) {
  overlayFrameDraft.value = null;
  const previous = state.value.expanded;
  if (previous && previous !== cardId) void markCardClosed(previous);
  state.value = setExpanded(state.value, cardId);
  void markCardRead(cardId);
  connectKey.value++;
}
function closeOverlay() {
  const previous = state.value.expanded;
  overlayFrameDraft.value = null;
  state.value = setExpanded(state.value, null);
  if (previous) void markCardClosed(previous);
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

const activeOverlayFrame = computed(() => overlayFrameDraft.value ?? activeCard.value?.overlay ?? null);
const overlayCardStyle = computed<StyleValue>(() => {
  const frame = activeOverlayFrame.value;
  if (!frame) return {};
  return {
    position: "absolute" as const,
    left: `${frame.x}px`,
    top: `${frame.y}px`,
    width: `${frame.width}px`,
    height: `${frame.height}px`,
    transform: "none",
  };
});

function defaultOverlayFrame(): OverlayFrame {
  const width = Math.min(1100, Math.max(720, window.innerWidth - 96));
  const height = Math.min(760, Math.max(520, window.innerHeight - 96));
  return {
    x: Math.max(24, Math.round((window.innerWidth - width) / 2)),
    y: Math.max(24, Math.round((window.innerHeight - height) / 2)),
    width,
    height,
  };
}

function clampOverlayFrame(frame: OverlayFrame): OverlayFrame {
  const minWidth = Math.min(520, Math.max(280, window.innerWidth - 24));
  const minHeight = Math.min(360, Math.max(260, window.innerHeight - 24));
  const maxWidth = Math.max(minWidth, window.innerWidth - 24);
  const maxHeight = Math.max(minHeight, window.innerHeight - 24);
  const width = Math.min(Math.max(minWidth, frame.width), maxWidth);
  const height = Math.min(Math.max(minHeight, frame.height), maxHeight);
  return {
    width,
    height,
    x: Math.min(Math.max(12, frame.x), Math.max(12, window.innerWidth - width - 12)),
    y: Math.min(Math.max(12, frame.y), Math.max(12, window.innerHeight - height - 12)),
  };
}

function persistOverlayFrame(frame: OverlayFrame) {
  const card = activeCard.value;
  if (!card) return;
  commit(updateOverlayFrame(state.value, card.id, clampOverlayFrame(frame)));
}

function beginOverlayPointer(e: PointerEvent, mode: "drag" | "resize") {
  const card = activeCard.value;
  if (!card || e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const start = activeOverlayFrame.value ?? defaultOverlayFrame();
  const origin = { x: e.clientX, y: e.clientY };
  overlayFrameDraft.value = start;
  const move = (ev: PointerEvent) => {
    const dx = ev.clientX - origin.x;
    const dy = ev.clientY - origin.y;
    overlayFrameDraft.value =
      mode === "drag"
        ? clampOverlayFrame({ ...start, x: start.x + dx, y: start.y + dy })
        : clampOverlayFrame({ ...start, width: start.width + dx, height: start.height + dy });
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    if (overlayFrameDraft.value) persistOverlayFrame(overlayFrameDraft.value);
    overlayFrameDraft.value = null;
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up, { once: true });
}

function beginOverlayDrag(e: PointerEvent) {
  beginOverlayPointer(e, "drag");
}

function beginOverlayResize(e: PointerEvent) {
  beginOverlayPointer(e, "resize");
}

// ---- memo panel (collapse + resize) ----
// A never-toggled card (memoPanel null) opens collapsed when the memo is empty
// and expanded when it has content; an explicit toggle wins from then on.
const MEMO_DEFAULT_HEIGHT = 120;
const MEMO_MIN_HEIGHT = 48;
const memoPanelDraft = ref<MemoPanel | null>(null);
const overlayBodyRef = ref<HTMLElement | null>(null);

const activeMemoPanel = computed<MemoPanel>(() => {
  if (memoPanelDraft.value) return memoPanelDraft.value;
  const card = activeCard.value;
  if (card?.memoPanel) return card.memoPanel;
  return { collapsed: !(card?.memo ?? "").trim(), height: MEMO_DEFAULT_HEIGHT };
});
const memoCollapsed = computed(() => activeMemoPanel.value.collapsed);
const memoPreview = computed(
  () =>
    memoDraft.value
      .split("\n")
      .find((line) => line.trim())
      ?.trim() ?? "",
);

function clampMemoHeight(height: number): number {
  const body = overlayBodyRef.value;
  const max = body ? Math.max(MEMO_MIN_HEIGHT, Math.round(body.clientHeight * 0.6)) : 400;
  return Math.min(Math.max(MEMO_MIN_HEIGHT, Math.round(height)), max);
}

function toggleMemoPanel() {
  const card = activeCard.value;
  if (!card) return;
  const panel = activeMemoPanel.value;
  commit(updateMemoPanel(state.value, card.id, { collapsed: !panel.collapsed, height: panel.height }));
}

function beginMemoResize(e: PointerEvent) {
  const card = activeCard.value;
  if (!card || e.button !== 0) return;
  e.preventDefault();
  const start = activeMemoPanel.value;
  const originY = e.clientY;
  const move = (ev: PointerEvent) => {
    memoPanelDraft.value = { collapsed: false, height: clampMemoHeight(start.height + (ev.clientY - originY)) };
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    if (memoPanelDraft.value) commit(updateMemoPanel(state.value, card.id, memoPanelDraft.value));
    memoPanelDraft.value = null;
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up, { once: true });
}

// ---- memory visibility ----
const totalRssKb = ref(0);
function formatMemory(kb: number): string {
  if (kb <= 0) return "0 MB";
  return `${Math.max(1, Math.round(kb / 1024))} MB`;
}
async function loadMemory() {
  try {
    const res = await fetch("/api/memory");
    if (!res.ok) return;
    const data = (await res.json()) as { totalRssKb?: number; sessions?: Array<{ sessionId: string; rssKb: number }> };
    totalRssKb.value = typeof data.totalRssKb === "number" ? data.totalRssKb : 0;
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
  if (dragging.value) {
    const card = state.value.cards.find((c) => c.id === dragging.value);
    commit(card?.archived ? restoreCard(state.value, dragging.value, lane) : moveCard(state.value, dragging.value, lane));
  }
  onDragEnd();
}

// ---- archive and multi-select ----
const archiveExpanded = ref(false);
const archiveDropTarget = ref(false);
const selectedCardIds = ref(new Set<string>());
const expandedMemos = ref(new Set<string>());
const boardRef = ref<HTMLElement | null>(null);
const selectionRect = ref<{ x: number; y: number; width: number; height: number } | null>(null);
const archivedVisibleCards = computed(() => archivedCards(state.value).filter(projectVisible));
const selectedCards = computed(() => state.value.cards.filter((card) => selectedCardIds.value.has(card.id) && !card.archived));

function isRunningCard(card: KanbanCard): boolean {
  return card.lastStatus === "working" || card.lane === "in_progress";
}

function confirmArchive(cards: KanbanCard[]): boolean {
  if (!cards.some(isRunningCard)) return true;
  return window.confirm("実行中の可能性があるターミナルを Archive します。ターミナルを終了してよいですか？");
}

async function releaseCardTerminal(card: KanbanCard) {
  if (!card.terminal.sessionId) return;
  try {
    const res = await fetch(`/api/cards/${encodeURIComponent(card.id)}/terminal`, { method: "DELETE" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    boardError.value = `Failed to release archived terminal: ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function archiveCardIds(ids: string[]) {
  const cards = state.value.cards.filter((card) => ids.includes(card.id) && !card.archived);
  if (!cards.length || !confirmArchive(cards)) return;
  await persistBoard(
    archiveCards(
      state.value,
      cards.map((card) => card.id),
    ),
  );
  selectedCardIds.value = new Set();
  // Drop archived cards' memo-expansion state so an unarchive later starts collapsed.
  const remaining = new Set(expandedMemos.value);
  for (const card of cards) remaining.delete(card.id);
  expandedMemos.value = remaining;
  for (const card of cards) await releaseCardTerminal(card);
}

function archiveOne(card: KanbanCard, e?: MouseEvent) {
  e?.stopPropagation();
  void archiveCardIds([card.id]);
}

function archiveSelected() {
  void archiveCardIds([...selectedCardIds.value]);
}

function onDropArchive() {
  if (dragging.value) void archiveCardIds([dragging.value]);
  archiveDropTarget.value = false;
  onDragEnd();
}

function rectsIntersect(a: DOMRect, b: { left: number; top: number; right: number; bottom: number }) {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

function beginSelection(e: PointerEvent) {
  if (e.button !== 0 || !boardRef.value) return;
  const target = e.target as HTMLElement | null;
  if (target?.closest(".card, .lane-header, .archive-strip, button")) return;
  const origin = { x: e.clientX, y: e.clientY };
  selectedCardIds.value = new Set();
  const move = (ev: PointerEvent) => {
    const x = Math.min(origin.x, ev.clientX);
    const y = Math.min(origin.y, ev.clientY);
    const width = Math.abs(ev.clientX - origin.x);
    const height = Math.abs(ev.clientY - origin.y);
    selectionRect.value = { x, y, width, height };
    const selection = { left: x, top: y, right: x + width, bottom: y + height };
    const next = new Set<string>();
    for (const el of boardRef.value?.querySelectorAll<HTMLElement>("[data-card-id]") ?? []) {
      if (rectsIntersect(el.getBoundingClientRect(), selection)) next.add(el.dataset.cardId ?? "");
    }
    next.delete("");
    selectedCardIds.value = next;
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    if (selectionRect.value && selectionRect.value.width < 5 && selectionRect.value.height < 5) selectedCardIds.value = new Set();
    selectionRect.value = null;
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up, { once: true });
}

function toggleMemo(id: string) {
  const next = new Set(expandedMemos.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expandedMemos.value = next;
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

      <div ref="boardRef" class="board" role="list" aria-label="Kanban board" @pointerdown="beginSelection">
        <section
          v-for="lane in LANES"
          :key="lane.id"
          class="lane"
          :class="{ 'drop-target': dropLane === lane.id, collapsed: collapsedLanes.has(lane.id) }"
          role="listitem"
          :aria-label="lane.title"
          @dragover.prevent="dropLane = lane.id"
          @dragleave="dropLane === lane.id && (dropLane = null)"
          @drop.prevent="onDrop(lane.id)"
        >
          <header class="lane-header">
            <button
              type="button"
              class="lane-collapse-btn"
              :title="collapsedLanes.has(lane.id) ? `Expand ${lane.title}` : `Collapse ${lane.title}`"
              :aria-label="collapsedLanes.has(lane.id) ? `Expand ${lane.title}` : `Collapse ${lane.title}`"
              :aria-expanded="!collapsedLanes.has(lane.id)"
              @click="toggleLaneCollapse(lane.id)"
            >
              <span class="material-symbols-outlined">chevron_left</span>
            </button>
            <span class="lane-title">{{ lane.title }}</span>
            <span class="lane-count">{{ visibleLaneCards(lane.id).length }}</span>
            <span v-if="collapsedLanes.has(lane.id) && laneHasUnread(lane.id)" class="lane-unread" title="Moved while closed">●</span>
          </header>
          <div v-if="!collapsedLanes.has(lane.id)" class="lane-cards" :data-size="cardSize">
            <article
              v-for="c in visibleLaneCards(lane.id)"
              :key="c.id"
              :data-card-id="c.id"
              class="card"
              :class="{ unread: c.unread, dragging: dragging === c.id, selected: selectedCardIds.has(c.id) }"
              :style="{ borderLeftColor: projectFor(c)?.color ?? NONE_COLOR }"
              draggable="true"
              tabindex="0"
              :title="cardTitle(c)"
              @dragstart="onDragStart(c.id, $event)"
              @dragend="onDragEnd"
              @click="openCard(c.id)"
              @keydown.enter="openCard(c.id)"
            >
              <div class="card-main">
                <span class="card-dot" :class="`dot-${dotState(c)}`" :title="c.unread ? 'Moved while closed' : undefined" aria-hidden="true" />
                <span class="card-title">{{ cardTitle(c) }}</span>
                <span v-if="c.unread" class="sr-only">Unread: moved while closed</span>
                <button type="button" class="card-action" title="Archive" aria-label="Archive" @keydown.enter.stop @click="archiveOne(c, $event)">
                  <span class="material-symbols-outlined">archive</span>
                </button>
              </div>
              <!-- Only surfaced at the "large" density (see .lane-cards[data-size="l"]). -->
              <div v-if="projectFor(c)" class="card-meta">
                <span class="card-project-swatch" :style="{ background: projectFor(c)?.color ?? NONE_COLOR }" />
                <span class="card-project-name">{{ projectFor(c)?.name }}</span>
              </div>
              <!-- Memo preview: hidden at "s", clamped at "m"/"l" (see .card-memo-row). -->
              <div v-if="c.memo.trim()" class="card-memo-row">
                <p class="card-memo" :class="{ expanded: expandedMemos.has(c.id) }">{{ c.memo }}</p>
                <button
                  v-if="memoHasOverflow(c.memo, cardSize)"
                  type="button"
                  class="memo-toggle"
                  :title="expandedMemos.has(c.id) ? 'Collapse memo' : 'Expand memo'"
                  :aria-label="expandedMemos.has(c.id) ? 'Collapse memo' : 'Expand memo'"
                  :aria-expanded="expandedMemos.has(c.id)"
                  @keydown.enter.stop
                  @click.stop="toggleMemo(c.id)"
                >
                  <span class="material-symbols-outlined">{{ expandedMemos.has(c.id) ? "expand_less" : "expand_more" }}</span>
                </button>
              </div>
            </article>
          </div>
        </section>

        <aside
          class="archive-strip"
          :class="{ expanded: archiveExpanded, 'drop-target': archiveDropTarget }"
          aria-label="Archive"
          @dragover.prevent="archiveDropTarget = true"
          @dragleave="archiveDropTarget = false"
          @drop.prevent="onDropArchive"
        >
          <button
            type="button"
            class="archive-toggle"
            :title="archiveExpanded ? 'Collapse archive' : 'Expand archive'"
            :aria-expanded="archiveExpanded"
            @click="archiveExpanded = !archiveExpanded"
          >
            <span class="material-symbols-outlined">{{ archiveExpanded ? "chevron_right" : "inventory_2" }}</span>
            <span class="archive-toggle-text">Archive</span>
            <span class="archive-count">{{ archivedVisibleCards.length }}</span>
          </button>
          <template v-if="archiveExpanded">
            <div class="archive-cards">
              <article
                v-for="c in archivedVisibleCards"
                :key="c.id"
                class="card archived-card"
                :class="{ dragging: dragging === c.id }"
                draggable="true"
                tabindex="0"
                :title="cardTitle(c)"
                @dragstart="onDragStart(c.id, $event)"
                @dragend="onDragEnd"
              >
                <div class="card-main">
                  <span class="card-dot" :class="`dot-${dotState(c)}`" aria-hidden="true" />
                  <span class="card-title">{{ cardTitle(c) }}</span>
                </div>
              </article>
              <div v-if="archivedVisibleCards.length === 0" class="archive-empty">No archived cards</div>
            </div>
          </template>
        </aside>
      </div>
    </div>

    <div v-if="selectedCards.length" class="bulk-bar" role="toolbar" aria-label="Bulk actions">
      <span>{{ selectedCards.length }} selected</span>
      <button type="button" class="btn" @click="selectedCardIds = new Set()">Clear</button>
      <button type="button" class="btn btn-primary" @click="archiveSelected">Archive</button>
    </div>

    <div
      v-if="selectionRect"
      class="selection-rect"
      :style="{
        left: `${selectionRect.x}px`,
        top: `${selectionRect.y}px`,
        width: `${selectionRect.width}px`,
        height: `${selectionRect.height}px`,
      }"
    />

    <div v-if="overlayOpen && activeCard" class="overlay" @click.self="closeOverlay">
      <div class="overlay-card" :style="overlayCardStyle">
        <header class="overlay-header" :style="{ borderTopColor: projectFor(activeCard)?.color ?? NONE_COLOR }" @pointerdown="beginOverlayDrag">
          <span class="overlay-grip material-symbols-outlined" aria-hidden="true">drag_indicator</span>
          <input v-model="nameDraft" class="overlay-title-input" aria-label="Card name" @pointerdown.stop @change="saveCardText" />
          <button type="button" class="overlay-close" title="Archive" aria-label="Archive" @pointerdown.stop @click="archiveOne(activeCard, $event)">
            <span class="material-symbols-outlined">archive</span>
          </button>
          <button
            v-if="activeCard.terminal.sessionId"
            type="button"
            class="overlay-close"
            title="Restart terminal"
            aria-label="Restart terminal"
            @pointerdown.stop
            @click="restartCardTerminal"
          >
            <span class="material-symbols-outlined">restart_alt</span>
          </button>
          <button type="button" class="overlay-close" title="Close card" aria-label="Close card" @pointerdown.stop @click="closeOverlay">
            <span class="material-symbols-outlined">close</span>
          </button>
        </header>
        <div ref="overlayBodyRef" class="overlay-body">
          <button type="button" class="memo-bar" :aria-expanded="!memoCollapsed" @click="toggleMemoPanel">
            <span class="memo-chevron material-symbols-outlined" aria-hidden="true">{{ memoCollapsed ? "chevron_right" : "expand_more" }}</span>
            <span class="memo-label">Memo</span>
            <span v-if="memoCollapsed && memoPreview" class="memo-preview">{{ memoPreview }}</span>
          </button>
          <template v-if="!memoCollapsed">
            <textarea
              v-model="memoDraft"
              class="memo"
              :style="{ height: `${activeMemoPanel.height}px` }"
              placeholder="Memo"
              aria-label="Memo"
              @change="saveCardText"
            />
            <div class="memo-resize" role="separator" aria-orientation="horizontal" aria-label="Resize memo" @pointerdown="beginMemoResize" />
          </template>
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
        <span class="overlay-resize" aria-hidden="true" @pointerdown="beginOverlayResize" />
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
  position: relative;
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
  overflow: hidden;
}
.lane.drop-target {
  border-color: var(--accent);
  background: var(--bg-hover);
}
.lane.collapsed {
  flex: 0 0 42px;
  min-width: 42px;
}
.lane.collapsed .lane-header {
  flex-direction: column;
  height: 100%;
  padding: 12px 6px 10px;
  border-bottom: none;
  gap: 8px;
}
.lane.collapsed .lane-title {
  writing-mode: vertical-rl;
  text-orientation: mixed;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lane.collapsed .lane-count {
  padding: 1px 6px;
}
.lane.collapsed .lane-collapse-btn .material-symbols-outlined {
  transform: rotate(180deg);
}
.lane-collapse-btn {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: var(--text-dim);
  cursor: pointer;
}
.lane-collapse-btn:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.lane-collapse-btn .material-symbols-outlined {
  font-size: 18px;
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
.lane-unread {
  color: var(--accent);
  font-size: 10px;
  flex-shrink: 0;
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
  flex-direction: column;
  gap: 6px;
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
.card.selected {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.card.dragging {
  opacity: 0.5;
}
/* Anchor for the absolutely-positioned archive action so it stays centered on
   this row even when the large size adds project/memo rows below. */
.card-main {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.card-title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  line-height: 1.15;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.card.unread .card-title {
  font-weight: 700;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.card-action {
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  opacity: 0;
}
.card:hover .card-action,
.card:focus-within .card-action,
.card.selected .card-action {
  opacity: 1;
  background: var(--bg-hover);
}
.card-action:hover {
  background: var(--bg-panel);
  color: var(--text);
}
.card-action .material-symbols-outlined {
  font-size: 17px;
}
/*
 * カードの丸は常に1個・状態は3つだけ(Issue #38)。
 * 優先順(working > unread > read)は dotState 関数(script)が明示的に決める。
 * done/blocked に丸の専用色は与えない(In Review / Done レーンが語る)。
 */
.card-dot {
  /* 既読(デフォルト): グレー輪郭の白抜き */
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex: 0 0 auto;
  border: 1.5px solid var(--text-muted);
  background: transparent;
}
.card-dot.dot-unread {
  /* 未読: 青の塗りつぶし・静止。ごく淡い静的グローのみ(点滅させない) */
  border-color: transparent;
  background: var(--accent);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 14%, transparent);
}
.card-dot.dot-working {
  /* 実行中: グレー塗り＋点滅 */
  border-color: transparent;
  background: var(--text-muted);
  animation: kanban-pulse 1.2s ease-in-out infinite;
}
@keyframes kanban-pulse {
  50% {
    opacity: 0.3;
  }
}
@media (prefers-reduced-motion: reduce) {
  .card-dot.dot-working {
    animation: none;
  }
}

/* Project name — only surfaced at the "large" card size (see below). */
.card-meta {
  display: none;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-muted);
}
.card-project-swatch {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  flex: 0 0 auto;
}
.card-project-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Memo preview: hidden at "s", clamped to 1 line at "m" / 3 lines at "l", with
   an expand/collapse toggle surfaced only when the memo overflows the clamp
   (see .memo-toggle and cardMemo.ts). */
.card-memo-row {
  display: none;
}
.card-memo {
  margin: 0;
  flex: 1 1 auto;
  min-width: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-muted);
  white-space: pre-line;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.memo-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
}
.memo-toggle:hover {
  color: var(--text);
}
.memo-toggle:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.memo-toggle .material-symbols-outlined {
  font-size: 17px;
}

/* ---- card size: small — maximise density, strip decoration ---- */
.lane-cards[data-size="s"] {
  gap: 4px;
  padding: 8px;
}
.lane-cards[data-size="s"] .card {
  gap: 0;
  padding: 6px 8px;
  border-left-width: 3px;
  border-radius: 6px;
}
.lane-cards[data-size="s"] .card-main {
  gap: 6px;
}
.lane-cards[data-size="s"] .card-title {
  font-size: 12px;
}
.lane-cards[data-size="s"] .card-dot {
  width: 7px;
  height: 7px;
}

/* ---- card size: medium — surface a 1-line memo preview ---- */
.lane-cards[data-size="m"] .card-memo-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}
.lane-cards[data-size="m"] .card-memo {
  -webkit-line-clamp: 1;
}
.lane-cards[data-size="m"] .card-memo.expanded {
  -webkit-line-clamp: unset;
}

/* ---- card size: large — surface project name + a 3-line memo preview ---- */
.lane-cards[data-size="l"] {
  gap: 12px;
  padding: 12px;
}
.lane-cards[data-size="l"] .card {
  gap: 8px;
  padding: 14px 16px;
  border-left-width: 6px;
  border-radius: 10px;
}
.lane-cards[data-size="l"] .card-main {
  gap: 10px;
}
.lane-cards[data-size="l"] .card-title {
  font-size: 15px;
}
.lane-cards[data-size="l"] .card-dot {
  width: 11px;
  height: 11px;
}
.lane-cards[data-size="l"] .card-meta {
  display: flex;
}
.lane-cards[data-size="l"] .card-memo-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}
.lane-cards[data-size="l"] .card-memo {
  -webkit-line-clamp: 3;
}
.lane-cards[data-size="l"] .card-memo.expanded {
  -webkit-line-clamp: unset;
}

.archive-strip {
  flex: 0 0 42px;
  margin-left: auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-panel) 78%, var(--bg-base));
  overflow: hidden;
}
.archive-strip.expanded {
  flex-basis: 260px;
}
.archive-strip.drop-target {
  border-color: var(--accent);
  background: var(--bg-hover);
}
.archive-toggle {
  min-width: 0;
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-rows: auto 1fr auto;
  align-items: center;
  justify-items: center;
  gap: 8px;
  padding: 10px 6px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-family: system-ui, sans-serif;
}
.archive-strip.expanded .archive-toggle {
  height: 42px;
  min-height: 42px;
  grid-template-columns: 22px minmax(0, 1fr) auto;
  grid-template-rows: 1fr;
  justify-items: start;
  border-bottom: 1px solid var(--border);
}
.archive-toggle:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.archive-toggle .material-symbols-outlined {
  font-size: 18px;
}
.archive-toggle-text {
  writing-mode: vertical-rl;
  text-orientation: mixed;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0;
}
.archive-strip.expanded .archive-toggle-text {
  writing-mode: horizontal-tb;
}
.archive-count {
  min-width: 22px;
  padding: 1px 6px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--bg-base);
  color: var(--text-muted);
  font-family: ui-monospace, monospace;
  font-size: 11px;
  text-align: center;
}
.archive-cards {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  overflow-y: auto;
}
.archived-card {
  filter: grayscale(1);
  opacity: 0.72;
}
.archive-empty {
  padding: 12px 4px;
  color: var(--text-muted);
  font-family: system-ui, sans-serif;
  font-size: 12px;
  text-align: center;
}
.bulk-bar {
  position: fixed;
  left: 50%;
  bottom: 18px;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-base);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.22);
  color: var(--text);
  font-family: system-ui, sans-serif;
  font-size: 13px;
  transform: translateX(-50%);
}
.selection-rect {
  position: fixed;
  z-index: 19;
  border: 1px solid var(--accent);
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  pointer-events: none;
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
  position: relative;
  display: flex;
  flex-direction: column;
  width: min(1100px, 100%);
  height: 100%;
  min-width: min(520px, calc(100vw - 24px));
  min-height: min(360px, calc(100vh - 24px));
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.35);
}
.overlay-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-top: 4px solid transparent;
  border-bottom: 1px solid var(--border);
  font-family: system-ui, sans-serif;
  cursor: move;
  user-select: none;
}
.overlay-grip {
  color: var(--text-muted);
  font-size: 19px;
  flex: 0 0 auto;
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
  cursor: text;
}
.overlay-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.memo-bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 8px;
  border: none;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
  color: var(--text-muted);
  font-family: system-ui, sans-serif;
  font-size: 11px;
  text-align: left;
  cursor: pointer;
}
.memo-bar:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.memo-chevron {
  font-size: 16px;
}
.memo-label {
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.memo-preview {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-dim);
}
.memo {
  flex: none;
  width: 100%;
  min-height: 0;
  padding: 10px 12px;
  border: none;
  resize: none;
  outline: none;
  background: var(--bg-base);
  color: var(--text);
  font-family: system-ui, sans-serif;
  font-size: 13px;
}
.memo-resize {
  flex: none;
  height: 6px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
  cursor: row-resize;
  touch-action: none;
}
.memo-resize:hover {
  background: var(--accent-bg);
}
.terminal-panel {
  min-height: 0;
  display: flex;
}
.overlay-terminal {
  flex: 1;
  min-height: 0;
}
.overlay-resize {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 20px;
  height: 20px;
  cursor: nwse-resize;
}
.overlay-resize::after {
  content: "";
  position: absolute;
  right: 5px;
  bottom: 5px;
  width: 9px;
  height: 9px;
  border-right: 2px solid var(--text-muted);
  border-bottom: 2px solid var(--text-muted);
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
