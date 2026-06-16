<script setup lang="ts">
import { ref } from "vue";
import Sidebar from "./components/Sidebar.vue";
import TerminalView from "./components/Terminal.vue";
import GuiPanel from "./components/GuiPanel.vue";

const activeId = ref<string | null>(null);
const connectKey = ref(0);
const terminalRef = ref<InstanceType<typeof TerminalView> | null>(null);

// GUI -> LLM: a plugin view (e.g. a submitted form) calls this with the user's
// response. We type it into the PTY, then send a SEPARATE delayed carriage return
// — a same-burst text+CR is treated as a paste by Claude Code's TUI and the CR
// becomes a newline instead of submitting. (Same mechanism MulmoClaude uses.)
function sendTextMessage(text: string) {
  const term = terminalRef.value;
  if (!term) return;
  term.sendText(text);
  setTimeout(() => terminalRef.value?.sendText("\r"), 60);
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
  <div class="app">
    <Sidebar
      :active-id="activeId"
      @select="selectSession"
      @new="newSession"
    />
    <div class="main">
      <TerminalView
        ref="terminalRef"
        :session-id="activeId"
        :connect-key="connectKey"
        @session="onSession"
      />
      <GuiPanel :session-id="activeId" :send-text-message="sendTextMessage" />
    </div>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
}

/* Sidebar | [ Terminal | GuiPanel ] — the unified two-panel view in miniature. */
.main {
  display: flex;
  flex: 1;
  min-width: 0;
}
</style>
