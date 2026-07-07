<script setup lang="ts">
import NotificationBell from "./NotificationBell.vue";
import { useSoundEnabled } from "../composables/useSoundEnabled";

const emit = defineEmits<{ (e: "settings"): void }>();
const { enabled: soundEnabled, toggle: toggleSound } = useSoundEnabled();
</script>

<template>
  <header class="toolbar">
    <span class="toolbar-title">kanban-terminal</span>
    <button type="button" class="launcher-btn active view-marker" title="Kanban board" aria-label="Kanban board">
      <span class="material-symbols-outlined">view_kanban</span>
    </button>
    <button type="button" class="launcher-btn archive-btn" title="Archive" aria-label="Archive" disabled>
      <span class="material-symbols-outlined">archive</span>
    </button>
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
.view-marker {
  margin-left: 16px;
}
.launcher-btn:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.launcher-btn:disabled {
  cursor: default;
  opacity: 0.45;
}
.launcher-btn:disabled:hover {
  background: transparent;
  color: var(--text-muted);
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
</style>
