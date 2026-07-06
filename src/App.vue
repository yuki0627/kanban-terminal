<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import { useRoute } from "vue-router";
import { router } from "./router";
import Sidebar from "./components/Sidebar.vue";
import SessionTabBar from "./components/SessionTabBar.vue";
import TerminalView from "./components/Terminal.vue";
import FilesOverlay from "./components/FilesOverlay.vue";
import GridView from "./components/GridView.vue";
import KanbanView from "./components/KanbanView.vue";
import SettingsModal from "./components/SettingsModal.vue";
import AppToolbar from "./components/AppToolbar.vue";
import { useSessions, type Filter } from "./composables/useSessions";
import { useAppConfig } from "./composables/useAppConfig";
import { useDirConfig } from "./composables/useDirConfig";
import { useFaviconState } from "./composables/useFaviconState";
import { usePendingScript, type PendingCommand } from "./composables/usePendingScript";
import { useSoundEnabled } from "./composables/useSoundEnabled";
import { useAttentionSound } from "./composables/useAttentionSound";
import { useUnloadGuard, reportActiveTerminals } from "./composables/useUnloadGuard";

// View mode is now the URL: the multi-terminal grid is /terminals, and everything
// else lives under the single-view shell.
const route = useRoute();
const isGrid = computed(() => route.name === "terminals");
const isKanban = computed(() => route.name === "kanban");

// A script picked from the terminal header's Run menu runs in the grid (command
// cells live only there): stash it and switch to the grid, which picks it up.
const { requestRun } = usePendingScript();
function onRunScript(command: PendingCommand) {
  requestRun(command);
  router.push("/terminals");
}

const activeId = ref<string | null>(null);
const connectKey = ref(0);

// Confirm before an accidental tab close / reload while a terminal is live. The
// single view reports its own session (0 or 1) under the "single" key; the grid
// reports its running-cell count under "grid". They're summed, not overwritten,
// because persistent connections keep the single PTY alive even after switching to
// the grid — so a hidden-but-live single terminal must still count toward the guard.
useUnloadGuard();
watch(
  [isGrid, activeId],
  () => {
    // Only the single view owns the "single" count; in the grid, the single PTY may
    // still be live (persistent connections) so its last reported count stands.
    if (!isGrid.value) reportActiveTerminals("single", activeId.value ? 1 : 0);
  },
  { immediate: true },
);

// Single source of truth for the session list, owned here (not inside the
// layout components) so toggling vertical/horizontal — which swaps Sidebar and
// SessionTabBar via v-if/v-else — never unmounts the store, refetches, or resets
// the filter. Both layouts render this same shared state.
const { sessions, loading, error, refresh } = useSessions();
const filter = ref<Filter>("all");

// Beep when any session needs attention (waiting) — across the single and grid
// views, including terminals on background grid pages. Listens to the "sessions"
// activity stream directly (same source as the cell status), independent of the
// fetched list above.
const { enabled: soundEnabled } = useSoundEnabled();
// soundFile is a shared singleton in useAppConfig, so the player here sees changes
// made from either view's settings modal (and loadConfig below hydrates it).
const { soundFile } = useAppConfig();
useAttentionSound(soundEnabled, soundFile);

// Reflect session activity in the tab's favicon (idle / working / attention).
useFaviconState(sessions);

// Settings (theme + notification sound), shared with the grid view via useAppConfig
// and opened from the toolbar's gear button.
const { defaultCwd, loadConfig, saveSound, launchers, saveLaunchers } = useAppConfig();
// Drive the single view's dir overrides off the dir the terminal ACTUALLY runs in
// (reported by the server, which may resolve/fall back), not the static default — so
// the badge/theme/colors always track the active session. Falls back to the default
// until the terminal reports its cwd.
const activeCwd = ref<string | null>(null);
const effectiveCwd = computed(() => activeCwd.value ?? defaultCwd.value);
const { config: singleDirConfig } = useDirConfig(effectiveCwd);
const showSettings = ref(false);
onMounted(loadConfig);
function closeSettings() {
  showSettings.value = false;
}

// Session-history layout: "vertical" (left Sidebar) or "horizontal" (top
// SessionTabBar). Persisted across reloads.
type Layout = "vertical" | "horizontal";
const layout = ref<Layout>(localStorage.getItem("session_layout") === "horizontal" ? "horizontal" : "vertical");
watch(layout, (v) => localStorage.setItem("session_layout", v));
function toggleLayout() {
  layout.value = layout.value === "vertical" ? "horizontal" : "vertical";
}

function selectSession(id: string) {
  activeId.value = id;
  connectKey.value++;
}

function newSession() {
  activeId.value = null;
  connectKey.value++;
}

// The server reports the live session id (a generated id for new sessions).
// Adopt it as the active id so it highlights. The sidebar list itself is
// driven server-side: the server publishes the new session on the "sessions"
// channel, so no client-side reload is needed here.
function onSession(id: string) {
  activeId.value = id;
}
</script>

<template>
  <GridView v-if="isGrid" />
  <KanbanView v-else-if="isKanban" />
  <div v-else class="shell">
    <AppToolbar @settings="showSettings = true" />
    <div :class="['app', layout === 'horizontal' ? 'app-horizontal' : 'app-vertical']">
      <Sidebar
        v-if="layout === 'vertical'"
        v-model:filter="filter"
        :sessions="sessions"
        :loading="loading"
        :error="error"
        :active-id="activeId"
        @select="selectSession"
        @new="newSession"
        @toggle-layout="toggleLayout"
        @refresh="refresh"
      />
      <SessionTabBar
        v-else
        v-model:filter="filter"
        :sessions="sessions"
        :active-id="activeId"
        @select="selectSession"
        @new="newSession"
        @toggle-layout="toggleLayout"
        @refresh="refresh"
      />
      <div class="main">
        <TerminalView
          class="terminal-pane"
          persist-key="single"
          :session-id="activeId"
          :connect-key="connectKey"
          :dir-theme="singleDirConfig.theme"
          :dir-colors="singleDirConfig.colors"
          :dir-name="singleDirConfig.name"
          :dir-badge-color="singleDirConfig.badgeColor"
          run-menu
          @session="onSession"
          @cwd="(c) => (activeCwd = c)"
          @run="onRunScript"
        />
      </div>
    </div>
    <!-- Full-screen file explorer + editor; opened by a terminal header's Files button. -->
    <FilesOverlay />
    <SettingsModal
      v-if="showSettings"
      :sound-file="soundFile"
      :launchers="launchers"
      @update-sound="saveSound"
      @update-launchers="saveLaunchers"
      @close="closeSettings"
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

.app {
  display: flex;
  flex: 1;
  min-height: 0;
  width: 100%;
  overflow: hidden;
}

/* Vertical: Sidebar | Terminal. */
.app-vertical {
  flex-direction: row;
}

/* Horizontal: SessionTabBar stacked above Terminal. */
.app-horizontal {
  flex-direction: column;
}

/* Terminal area bounded to the leftover height so it fills exactly instead of
   overflowing under `.app { overflow: hidden }`. */
.main {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.terminal-pane {
  flex: 1;
  min-width: 0;
  min-height: 0;
}
</style>
