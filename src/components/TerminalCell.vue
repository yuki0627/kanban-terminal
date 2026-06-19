<script setup lang="ts">
import { ref } from "vue";
import TerminalView from "./Terminal.vue";

// `expanded` reflects whether this cell is zoomed to fill the grid (parent owns
// the state). `initialSessionId` is a persisted session to resume on mount, so a
// page reload restores the terminals that were open (empty if null).
const props = defineProps<{ expanded: boolean; initialSessionId: string | null }>();
const emit = defineEmits<{ (e: "toggle-expand" | "close"): void; (e: "session", id: string): void }>();

// A cell with a persisted session relaunches (resumes) on mount; otherwise it
// starts empty and lazy-launches when the user clicks "New terminal".
const launched = ref(props.initialSessionId !== null);
const sessionId = ref<string | null>(props.initialSessionId);
const connectKey = ref(0);

function launch() {
  sessionId.value = null; // new session — the server generates the id
  connectKey.value++;
  launched.value = true;
}

function close() {
  launched.value = false;
  sessionId.value = null;
  emit("close");
}

// Adopt the server-assigned id (esp. for new sessions) and bubble it up so the
// grid can persist it for the next reload.
function onSession(id: string) {
  sessionId.value = id;
  emit("session", id);
}

const shortId = (id: string | null) => (id ? id.slice(0, 8) : "starting…");
</script>

<template>
  <div class="cell">
    <template v-if="launched">
      <div class="cell-header">
        <span class="cell-id" :title="sessionId ?? ''">{{ shortId(sessionId) }}</span>
        <span class="cell-actions">
          <button class="cell-btn" :title="expanded ? 'Restore' : 'Expand'" @click="emit('toggle-expand')">{{ expanded ? "⤡" : "⤢" }}</button>
          <button class="cell-btn cell-close" title="Close terminal" @click="close">✕</button>
        </span>
      </div>
      <TerminalView class="cell-term" :session-id="sessionId" :connect-key="connectKey" @session="onSession" />
    </template>
    <button v-else class="cell-empty" @click="launch">＋ New terminal</button>
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
  justify-content: space-between;
  height: 34px;
  padding: 0 8px;
  background: #16213e;
  border-bottom: 1px solid #2a2a4e;
}
.cell-id {
  font-family: ui-monospace, "JetBrains Mono", monospace;
  font-size: 12px;
  color: #9aa3c0;
}
.cell-actions {
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

.cell-empty {
  flex: 1;
  border: none;
  background: transparent;
  color: #8b93b8;
  cursor: pointer;
  font-family: system-ui, sans-serif;
  font-size: 16px;
  font-weight: 500;
}
.cell-empty:hover {
  background: #20203a;
  color: #c7cdf0;
}
</style>
