<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, useTemplateRef } from "vue";
import TerminalView from "./Terminal.vue";
import { usePubSub } from "../composables/usePubSub";

const termRef = useTemplateRef<InstanceType<typeof TerminalView>>("termRef");

// `expanded` reflects whether this cell is zoomed to fill the grid (parent owns
// the state). `initialSessionId` is a persisted session to resume on mount, so a
// page reload restores the terminals that were open (empty if null). `cwd` is the
// workspace directory shown in the header.
const props = defineProps<{ expanded: boolean; initialSessionId: string | null; cwd: string | null }>();
const emit = defineEmits<{ (e: "toggle-expand" | "close"): void; (e: "session", id: string): void }>();

// A cell with a persisted session relaunches (resumes) on mount; otherwise it
// starts empty and lazy-launches when the user clicks "New terminal".
const launched = ref(props.initialSessionId !== null);
const sessionId = ref<string | null>(props.initialSessionId);
const connectKey = ref(0);

// Live activity for this session, from the "sessions" pub/sub channel.
const working = ref(false);
const waiting = ref(false);
const lastPrompt = ref<string | null>(null);

const { subscribe } = usePubSub();
let unsubscribe: (() => void) | null = null;

interface ActivityMsg {
  id: string;
  working?: boolean;
  waiting?: boolean;
  lastPrompt?: string | null;
}
const isActivityMsg = (d: unknown): d is ActivityMsg => typeof d === "object" && d !== null && "id" in d;

function applyActivity(d: ActivityMsg) {
  working.value = d.working ?? false;
  waiting.value = d.waiting ?? false;
  // Apply lastPrompt whenever the field is present — including an explicit null,
  // so a cleared/new session doesn't keep showing the previous prompt.
  if (d.lastPrompt !== undefined) lastPrompt.value = d.lastPrompt;
}

// Pull the initial status + last prompt so the header is populated immediately;
// live changes then arrive via pub/sub.
async function loadInitial(id: string) {
  try {
    const res = await fetch(`/api/session/${id}`);
    if (!res.ok) return;
    const data = await res.json();
    // Guard against a stale response: the cell may have closed / switched session
    // while the fetch was in flight — don't leak old status into the new state.
    if (id === sessionId.value) applyActivity(data);
  } catch {
    // best-effort — pub/sub will fill it in on the next event
  }
}

onMounted(() => {
  unsubscribe = subscribe("sessions", (d) => {
    if (isActivityMsg(d) && d.id === sessionId.value) applyActivity(d);
  });
  if (sessionId.value) loadInitial(sessionId.value);
});
onUnmounted(() => unsubscribe?.());

function launch() {
  sessionId.value = null; // new session — the server generates the id
  connectKey.value++;
  launched.value = true;
}

function close() {
  // Ask the server to reap this session immediately (don't hold it through the
  // disconnect grace window), then tear the cell down.
  termRef.value?.terminate();
  launched.value = false;
  sessionId.value = null;
  working.value = false;
  waiting.value = false;
  lastPrompt.value = null;
  emit("close");
}

// Adopt the server-assigned id (esp. for new sessions), bubble it up for
// persistence, and load its initial activity.
function onSession(id: string) {
  sessionId.value = id;
  emit("session", id);
  loadInitial(id);
}

const dirBase = computed(() => {
  if (!props.cwd) return "";
  // Split on both separators so a Windows path (C:\work\proj) yields the basename
  // too, not the whole path.
  const parts = props.cwd.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || props.cwd;
});

// Attention (waiting) wins over working wins over idle.
const status = computed<"waiting" | "working" | "idle">(() => {
  if (waiting.value) return "waiting";
  if (working.value) return "working";
  return "idle";
});
const STATUS_CLASS = { waiting: "is-waiting", working: "is-working", idle: "is-idle" } as const;
const STATUS_LABEL = { waiting: "Needs attention", working: "Working…", idle: "Idle" } as const;
const statusClass = computed(() => STATUS_CLASS[status.value]);
const statusLabel = computed(() => STATUS_LABEL[status.value]);

const headerText = computed(() => lastPrompt.value || (sessionId.value ? sessionId.value.slice(0, 8) : "starting…"));
</script>

<template>
  <div class="cell">
    <template v-if="launched">
      <div class="cell-header">
        <span class="cell-dot" :class="statusClass" :title="statusLabel" />
        <span v-if="dirBase" class="cell-dir" :title="cwd ?? ''">{{ dirBase }}</span>
        <span class="cell-prompt" :title="lastPrompt ?? ''">{{ headerText }}</span>
        <span class="cell-actions">
          <button
            class="cell-btn"
            :title="expanded ? 'Restore' : 'Expand'"
            :aria-label="expanded ? 'Restore terminal' : 'Expand terminal'"
            @click="emit('toggle-expand')"
          >
            {{ expanded ? "⤡" : "⤢" }}
          </button>
          <button class="cell-btn cell-close" title="Close terminal" aria-label="Close terminal" @click="close">✕</button>
        </span>
      </div>
      <TerminalView ref="termRef" class="cell-term" :session-id="sessionId" :connect-key="connectKey" @session="onSession" />
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
  gap: 8px;
  height: 34px;
  padding: 0 8px;
  background: #16213e;
  border-bottom: 1px solid #2a2a4e;
}

/* Status dot: idle / working (pulsing) / waiting (attention). */
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
.cell-dot.is-waiting {
  background: #ffb454;
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
  flex: 0 0 auto;
  max-width: 40%;
  font-family: ui-monospace, "JetBrains Mono", monospace;
  font-size: 11px;
  color: #7f88ad;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cell-prompt {
  flex: 1 1 auto;
  min-width: 0;
  font-family: system-ui, sans-serif;
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
