<script setup lang="ts">
import { computed } from "vue";
import NotificationBell from "./NotificationBell.vue";
import { useSoundEnabled } from "../composables/useSoundEnabled";
import { useCardSize, CARD_SIZES, type CardSizeId } from "../composables/useCardSize";

const emit = defineEmits<{ (e: "settings"): void }>();
const { enabled: soundEnabled, toggle: toggleSound } = useSoundEnabled();
const { cardSize, cycleCardSize } = useCardSize();

const currentSizeLabel = computed(() => CARD_SIZES.find((s) => s.id === cardSize.value)?.label ?? "");
const nextSizeLabel = computed(() => {
  const index = CARD_SIZES.findIndex((s) => s.id === cardSize.value);
  return CARD_SIZES[(index + 1) % CARD_SIZES.length].label;
});
const sizeToggleTitle = computed(() => `Card size: ${currentSizeLabel.value} — click for ${nextSizeLabel.value}`);

// Icon geometry per card size, mirrors docs/ui-proposals/card-size-ui-proposals.html
// (proposal-c). Attribute bindings are used instead of CSS custom-property driven
// styles because Vue's SVG attribute binding is guaranteed to apply the raw `y`/
// `height`/`opacity` presentation attributes across browsers.
type BarGeometry = { y?: number; height?: number; opacity?: number };
const BAR_GEOMETRY: Record<CardSizeId, { bar1: BarGeometry; bar2: BarGeometry; bar3: BarGeometry; bar4: BarGeometry; chipDotOpacity: number }> = {
  s: {
    bar1: { y: 2, height: 1.3 },
    bar2: { y: 4.4, height: 1.3 },
    bar3: { y: 6.8, height: 1.3, opacity: 1 },
    bar4: { y: 9.2, height: 1.3, opacity: 1 },
    chipDotOpacity: 0,
  },
  m: {
    bar1: { y: 3, height: 2 },
    bar2: { y: 7, height: 2 },
    bar3: { y: 11, height: 2, opacity: 1 },
    bar4: { opacity: 0 },
    chipDotOpacity: 0,
  },
  l: {
    bar1: { y: 3, height: 3.6 },
    bar2: { y: 9.4, height: 3.6 },
    bar3: { opacity: 0 },
    bar4: { opacity: 0 },
    chipDotOpacity: 1,
  },
};
const iconGeometry = computed(() => BAR_GEOMETRY[cardSize.value]);
const bar1 = computed(() => iconGeometry.value.bar1);
const bar2 = computed(() => iconGeometry.value.bar2);
const bar3 = computed(() => iconGeometry.value.bar3);
const bar4 = computed(() => iconGeometry.value.bar4);
const chipDotOpacity = computed(() => iconGeometry.value.chipDotOpacity);
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
    <button type="button" class="launcher-btn size-toggle" :title="sizeToggleTitle" :aria-label="sizeToggleTitle" @click="cycleCardSize">
      <svg class="size-icon" width="18" height="18" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <rect class="bar" x="2" width="12" rx="1" :y="bar1.y" :height="bar1.height" />
        <rect class="bar" x="2" width="12" rx="1" :y="bar2.y" :height="bar2.height" />
        <rect class="bar" x="2" width="12" rx="1" :y="bar3.y" :height="bar3.height" :opacity="bar3.opacity" />
        <rect class="bar" x="2" width="12" rx="1" :y="bar4.y" :height="bar4.height" :opacity="bar4.opacity" />
        <circle class="chip-dot" cx="13.2" cy="2.6" r="1.3" :opacity="chipDotOpacity" />
      </svg>
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

/* Card-size cycle toggle: single icon button that steps s -> m -> l -> s. */
.size-icon {
  display: block;
}
.bar,
.chip-dot {
  fill: currentColor;
}
.chip-dot {
  fill: var(--accent);
}
</style>
