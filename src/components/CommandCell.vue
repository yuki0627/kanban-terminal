<script setup lang="ts">
import { computed, ref } from "vue";
import TerminalView from "./Terminal.vue";
import { formatCwd } from "./cwdDisplay";

// A grid cell that runs a `script.json` command (a cell launcher's Run) instead of
// a Claude session. Ephemeral: it has no session id and isn't persisted — a reload
// drops it. `command.index` is the script's position in `<command.cwd>/script.json`
// (the server resolves it); the command runs in `command.cwd`.
const props = defineProps<{ expanded: boolean; command: { index: number; label: string; cwd: string | null }; home: string | null }>();
const emit = defineEmits<{ (e: "toggle-expand" | "close"): void }>();

// connectKey forces Terminal.vue to (re)connect — bumped to re-run after exit.
const connectKey = ref(0);
const finished = ref(false);

const dirDisplay = computed(() => formatCwd(props.command.cwd, props.home));

function onExit() {
  finished.value = true;
}

function rerun() {
  finished.value = false;
  connectKey.value++;
}
</script>

<template>
  <div class="cell">
    <div class="cell-header">
      <span class="cell-dot" :class="finished ? 'is-idle' : 'is-working'" :title="finished ? 'Finished' : 'Running…'" />
      <span v-if="dirDisplay" class="cell-dir" :title="command.cwd ?? ''"
        ><span class="cell-dir-path">{{ dirDisplay }}</span></span
      >
      <span class="cell-cmd">▶ {{ command.label }}</span>
      <span class="cell-actions">
        <button v-if="finished" class="cell-btn" title="Re-run" aria-label="Re-run command" @click="rerun">↻</button>
        <button
          class="cell-btn"
          :title="expanded ? 'Restore' : 'Expand'"
          :aria-label="expanded ? 'Restore terminal' : 'Expand terminal'"
          @click="emit('toggle-expand')"
        >
          {{ expanded ? "⤡" : "⤢" }}
        </button>
        <button class="cell-btn cell-close" title="Close terminal" aria-label="Close terminal" @click="emit('close')">✕</button>
      </span>
    </div>
    <TerminalView class="cell-term" :session-id="null" :connect-key="connectKey" :cwd="command.cwd" :command="command" @exit="onExit" />
  </div>
</template>

<style scoped>
.cell {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: #1a1a2e;
  border: 1px solid #2a2a4e;
  border-radius: 6px;
  overflow: hidden;
}

.cell-header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 8px;
  background: #16213e;
  border-bottom: 1px solid #2a2a4e;
}

.cell-dot {
  flex: 0 0 auto;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #4a5070;
}
.cell-dot.is-working {
  background: #4a8cff;
  animation: pulse 1.2s ease-in-out infinite;
}
@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

.cell-dir {
  flex: 0 1 auto;
  max-width: 45%;
  font-family: ui-monospace, "JetBrains Mono", monospace;
  font-size: 11px;
  color: #7f88ad;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  /* Truncate from the FRONT so the tail (the project dir) stays visible. */
  direction: rtl;
}
.cell-dir-path {
  unicode-bidi: plaintext;
}
.cell-cmd {
  flex: 1 1 auto;
  min-width: 0;
  font-family: ui-monospace, "JetBrains Mono", monospace;
  font-size: 12px;
  color: #c7cdf0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cell-actions {
  flex: 0 0 auto;
  display: flex;
  gap: 4px;
}
.cell-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 26px;
  border: none;
  background: transparent;
  color: #c7cdf0;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  border-radius: 6px;
}
.cell-btn:hover {
  background: #2a3b66;
  color: #e6e6f0;
}
.cell-close:hover {
  background: #3a2030;
  color: #ff6b6b;
}

.cell-term {
  flex: 1;
  min-height: 0;
}
</style>
