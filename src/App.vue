<script setup lang="ts">
import TerminalGrid from "./components/TerminalGrid.vue";
</script>

<template>
  <div class="shell">
    <header class="toolbar">
      <span class="toolbar-title">MulmoTerminal</span>
    </header>
    <TerminalGrid class="main" />
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

/* Top toolbar with the app title. */
.toolbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  height: 40px;
  padding: 0 16px;
  background: #16213e;
  border-bottom: 1px solid #2a2a4e;
}
.toolbar-title {
  font-family: system-ui, sans-serif;
  font-weight: 600;
  font-size: 14px;
  color: #e6e6f0;
  letter-spacing: 0.02em;
}

/* The grid fills everything under the toolbar. */
.main {
  flex: 1;
  min-height: 0;
  min-width: 0;
}
</style>
