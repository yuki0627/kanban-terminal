<script setup lang="ts">
import NotificationBell from "./NotificationBell.vue";
import { useSoundEnabled } from "../composables/useSoundEnabled";
import { useCardSize } from "../composables/useCardSize";

const emit = defineEmits<{ (e: "settings"): void }>();
const { enabled: soundEnabled, toggle: toggleSound } = useSoundEnabled();
const { cardSize, sizes: cardSizes, setCardSize } = useCardSize();
</script>

<template>
  <header class="toolbar">
    <span class="toolbar-title">kanban-terminal</span>
    <button type="button" class="launcher-btn active view-marker" title="Kanban board" aria-label="Kanban board">
      <span class="material-symbols-outlined">view_kanban</span>
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
    <span class="toolbar-divider" aria-hidden="true" />
    <div class="size-segment" role="group" aria-label="Card size">
      <button
        v-for="s in cardSizes"
        :key="s.id"
        type="button"
        class="launcher-btn size-btn"
        :class="{ active: cardSize === s.id }"
        :title="`Card size: ${s.label}`"
        :aria-label="`Card size: ${s.label}`"
        :aria-pressed="cardSize === s.id"
        @click="setCardSize(s.id)"
      >
        <span class="material-symbols-outlined">{{ s.icon }}</span>
      </button>
    </div>
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

/* Thin separator between the action group and the card-size segment. */
.toolbar-divider {
  flex: 0 0 auto;
  width: 1px;
  height: 18px;
  margin: 0 6px;
  background: var(--border);
}
/* Card-size segment: three density buttons framed as one control so the trio
   reads as a single choice, echoing the toolbar's existing .launcher-btn buttons. */
.size-segment {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  gap: 2px;
  padding: 2px;
  border-radius: 8px;
  background: var(--bg-hover);
}
.size-btn {
  width: 28px;
  height: 26px;
  border-radius: 6px;
}
.size-btn:hover {
  background: var(--bg-selected);
}
.size-btn.active,
.size-btn.active:hover {
  background: var(--accent-bg);
  color: var(--on-accent);
}
.size-btn .material-symbols-outlined {
  font-size: 18px;
}
</style>
