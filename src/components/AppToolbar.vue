<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { router } from "../router";
import NotificationBell from "./NotificationBell.vue";
import { useSoundEnabled } from "../composables/useSoundEnabled";
import type { StatusCounts } from "./gridTabs";

// The standard header, shared by the single (App.vue) and grid (GridView.vue) views so
// both show one identical toolbar. Every launcher button now just pushes a route — the
// surface (single shell vs grid) is derived from the URL. The active states re-derive
// from route.name. Grid-only state (`addTerminalActive`, `autoSort`) is still passed
// in, and the grid-only actions (add-terminal / toggle-sort) and settings stay emits.
const props = defineProps<{ addTerminalActive?: boolean; autoSort?: boolean; statusCounts?: StatusCounts }>();
const emit = defineEmits<{ (e: "add-terminal" | "toggle-sort" | "settings"): void }>();

const route = useRoute();
// Grid-wide, at-a-glance tally: how many cells are blocked (need input) / done
// (review) / working, across every page. Shown only when something is running.
const summaryTitle = computed(() => {
  const c = props.statusCounts;
  if (!c) return "";
  const parts: string[] = [];
  if (c.blocked) parts.push(`${c.blocked} need input`);
  if (c.done) parts.push(`${c.done} done (review)`);
  if (c.working) parts.push(`${c.working} working`);
  if (c.idle) parts.push(`${c.idle} idle`);
  return parts.join(" · ");
});
const hasSummary = computed(() => !!props.statusCounts && props.statusCounts.blocked + props.statusCounts.done + props.statusCounts.working > 0);
const { enabled: soundEnabled, toggle: toggleSound } = useSoundEnabled();

const inGrid = computed(() => route.name === "terminals");
const inKanban = computed(() => route.name === "kanban");
const inSingle = computed(() => !inGrid.value && !inKanban.value);
const chatActive = computed(() => inSingle.value);

function showChat(): void {
  router.push("/");
}
function showGrid(): void {
  router.push("/terminals");
}
function showKanban(): void {
  router.push("/kanban");
}
</script>

<template>
  <header class="toolbar">
    <span class="toolbar-title">kanban-terminal</span>
    <nav class="launcher" aria-label="Views">
      <button type="button" class="launcher-btn" :class="{ active: chatActive }" title="Chat" aria-label="Chat" @click="showChat">
        <span class="material-symbols-outlined">chat</span>
      </button>
      <button type="button" class="launcher-btn" :class="{ active: inGrid }" title="Grid (multiple terminals)" aria-label="Grid view" @click="showGrid">
        <span class="material-symbols-outlined">grid_view</span>
      </button>
      <button type="button" class="launcher-btn" :class="{ active: inKanban }" title="Kanban board" aria-label="Kanban board" @click="showKanban">
        <span class="material-symbols-outlined">view_kanban</span>
      </button>
      <button
        v-if="inGrid"
        type="button"
        class="launcher-btn"
        :class="{ active: addTerminalActive }"
        :title="addTerminalActive ? 'Cancel adding a terminal' : 'New terminal (overflows to a new tab when full)'"
        aria-label="New terminal"
        @click="emit('add-terminal')"
      >
        <span class="material-symbols-outlined">add</span>
      </button>
      <button
        v-if="inGrid"
        type="button"
        class="launcher-btn"
        :class="{ active: autoSort }"
        :title="
          autoSort
            ? 'Auto order: attention-first — needs-attention cells float up (click for manual ◀▶ ordering)'
            : 'Manual order: reorder cells with ◀▶ (click for auto attention-sort)'
        "
        aria-label="Toggle grid cell ordering"
        :aria-pressed="autoSort"
        @click="emit('toggle-sort')"
      >
        <span class="material-symbols-outlined">{{ autoSort ? "sort" : "swap_horiz" }}</span>
      </button>
      <span v-if="inGrid && hasSummary && statusCounts" class="grid-summary" role="img" :aria-label="`Grid status — ${summaryTitle}`" :title="summaryTitle">
        <span v-if="statusCounts.blocked" class="gs gs-blocked" aria-hidden="true">{{ statusCounts.blocked }}</span>
        <span v-if="statusCounts.done" class="gs gs-done" aria-hidden="true">{{ statusCounts.done }}</span>
        <span v-if="statusCounts.working" class="gs gs-working" aria-hidden="true">{{ statusCounts.working }}</span>
      </span>
    </nav>
    <NotificationBell class="toolbar-bell" />
    <button
      type="button"
      class="launcher-btn sound-toggle"
      :class="{ active: soundEnabled }"
      :title="soundEnabled ? 'Attention sound on' : 'Attention sound off'"
      :aria-label="soundEnabled ? 'Attention sound on' : 'Attention sound off'"
      :aria-pressed="soundEnabled"
      @click="toggleSound"
    >
      <span class="material-symbols-outlined">{{ soundEnabled ? "notifications_active" : "notifications_off" }}</span>
    </button>
    <button type="button" class="launcher-btn settings-btn" title="Settings" aria-label="Settings" @click="emit('settings')">
      <span class="material-symbols-outlined">settings</span>
    </button>
  </header>
</template>

<style scoped>
/* Top toolbar with the app title. */
.toolbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  height: 40px;
  padding: 0 16px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
}
.toolbar-title {
  font-family: system-ui, sans-serif;
  font-weight: 600;
  font-size: 14px;
  color: var(--text);
  letter-spacing: 0.02em;
}

/* Toolbar tabs plus the grid-only New terminal button. Icon-only. */
.launcher {
  display: flex;
  align-items: center;
  gap: 3px;
  margin-left: 16px;
  min-width: 0;
  overflow-x: auto;
}
.launcher-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  height: 30px;
  width: 30px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-muted);
  border-radius: 6px;
  cursor: pointer;
}
.launcher-btn:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.launcher-btn.active {
  background: var(--accent-bg);
  color: var(--on-accent);
}
/* Push the action buttons (bell, sound, settings) to the far right as a group. */
.toolbar-bell {
  margin-left: auto;
}
.launcher-btn .material-symbols-outlined {
  font-size: 19px;
  line-height: 1;
}

/* Grid-wide status tally: blocked (amber, needs you) · done (blue, review) · working
   (dim, just busy). A colored dot + count each; grouped after the grid controls. */
.grid-summary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  margin-left: 6px;
  padding-left: 10px;
  border-left: 1px solid var(--border);
}
.gs {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: ui-monospace, "JetBrains Mono", monospace;
  font-size: 12px;
  line-height: 1;
}
.gs::before {
  content: "";
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
}
.gs-blocked {
  color: var(--amber);
}
.gs-done {
  color: var(--accent);
}
.gs-working {
  color: var(--text-muted);
}
</style>
