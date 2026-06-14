<script setup lang="ts">
import { ref } from "vue";
import Sidebar from "./components/Sidebar.vue";
import TerminalView from "./components/Terminal.vue";

const activeId = ref<string | null>(null);
const connectKey = ref(0);
const sidebar = ref<InstanceType<typeof Sidebar>>();

function selectSession(id: string) {
  activeId.value = id;
  connectKey.value++;
}

function newSession() {
  activeId.value = null;
  connectKey.value++;
}

// The server reports the live session id (a generated id for new sessions).
// Adopt it as the active id so it highlights and stops showing as unread.
function onSession(id: string) {
  activeId.value = id;
  sidebar.value?.load();
}
</script>

<template>
  <div class="app">
    <Sidebar
      ref="sidebar"
      :active-id="activeId"
      @select="selectSession"
      @new="newSession"
    />
    <TerminalView
      :session-id="activeId"
      :connect-key="connectKey"
      @session="onSession"
    />
  </div>
</template>

<style scoped>
.app {
  display: flex;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
}
</style>
