<script setup lang="ts">
import { ref } from "vue";
import TerminalCell from "./TerminalCell.vue";

// Fixed 2x2 grid. Zooming interface: the grid is the base view; clicking a cell's
// expand button zooms that one cell to fill the area, and restore returns to 2x2.
// Other cells stay MOUNTED while zoomed (hidden via CSS, not v-if) so their
// terminals keep running in the background.
const CELL_COUNT = 4;
const cells = Array.from({ length: CELL_COUNT }, (_, i) => i);
const expanded = ref<number | null>(null);

function toggleExpand(i: number) {
  expanded.value = expanded.value === i ? null : i;
}
</script>

<template>
  <div :class="['grid', { 'grid-zoomed': expanded !== null }]">
    <TerminalCell
      v-for="i in cells"
      :key="i"
      :class="{ 'cell-expanded': expanded === i, 'cell-hidden': expanded !== null && expanded !== i }"
      :expanded="expanded === i"
      @toggle-expand="toggleExpand(i)"
    />
  </div>
</template>

<style scoped>
.grid {
  height: 100%;
  width: 100%;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  grid-template-rows: repeat(2, 1fr);
  gap: 6px;
  padding: 6px;
  background: #0f0f1e;
  box-sizing: border-box;
}

/* Zoomed: collapse the grid to a single area; the expanded cell fills it and the
   others are hidden but stay mounted (their PTYs keep running). */
.grid-zoomed {
  grid-template-columns: 1fr;
  grid-template-rows: 1fr;
}
.cell-hidden {
  display: none;
}
</style>
