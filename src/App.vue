<script setup lang="ts">
import { ref, watch } from "vue";
import TerminalGrid from "./components/TerminalGrid.vue";
import { LAYOUTS, isLayout, type Layout } from "./components/gridLayout";

// Grid layout (cell arrangement), chosen in the toolbar and persisted.
const stored = localStorage.getItem("grid_layout");
const layout = ref<Layout>(isLayout(stored) ? stored : "2x2");
watch(layout, (v) => localStorage.setItem("grid_layout", v));
</script>

<template>
  <div class="shell">
    <header class="toolbar">
      <span class="toolbar-title">MulmoTerminal</span>
      <span class="layout-picker" role="group" aria-label="Grid layout">
        <button v-for="l in LAYOUTS" :key="l" :class="['layout-btn', { active: layout === l }]" :aria-pressed="layout === l" @click="layout = l">
          {{ l }}
        </button>
      </span>
    </header>
    <TerminalGrid class="main" :layout="layout" />
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

/* Top toolbar with the app title + layout picker. */
.toolbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 16px;
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

.layout-picker {
  margin-left: auto;
  display: flex;
  gap: 4px;
}
.layout-btn {
  border: 1px solid #2a2a4e;
  background: #1a1a2e;
  color: #9aa3c0;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  padding: 3px 8px;
  border-radius: 6px;
  cursor: pointer;
}
.layout-btn:hover {
  background: #2a3b66;
  color: #e6e6f0;
}
.layout-btn.active {
  background: #2a3b66;
  color: #fff;
  border-color: #4a8cff;
}

/* The grid fills everything under the toolbar. */
.main {
  flex: 1;
  min-height: 0;
  min-width: 0;
}
</style>
