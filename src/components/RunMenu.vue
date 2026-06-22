<script setup lang="ts">
import { ref, onUnmounted, useTemplateRef } from "vue";

// A toolbar dropdown that lists a directory's script.json entries and emits the one
// picked, so the grid can launch it in a spare cell. Scripts are (re)fetched each
// time the menu opens (the endpoint is cheap) so the list stays current.
interface RunnableScript {
  index: number;
  label: string;
  command: string;
}
const props = defineProps<{ cwd: string | null }>();
const emit = defineEmits<{ (e: "run", command: { index: number; label: string; cwd: string | null }): void }>();

const open = ref(false);
const scripts = ref<RunnableScript[]>([]);
const loading = ref(false);
// The resolved dir the listed scripts belong to (the server may fall back from a
// bad path); the picked command runs there.
const scriptsCwd = ref<string | null>(null);
let req = 0; // request token: drop out-of-order responses

const rootRef = useTemplateRef<HTMLElement>("root");

async function loadScripts() {
  const reqId = ++req;
  loading.value = true;
  try {
    const dir = props.cwd ?? "";
    const res = await fetch(`/api/scripts?cwd=${encodeURIComponent(dir)}`);
    const data = res.ok ? await res.json() : { scripts: [], cwd: dir };
    if (reqId !== req) return;
    scripts.value = Array.isArray(data.scripts) ? data.scripts : [];
    scriptsCwd.value = data.cwd ?? dir;
  } catch {
    if (reqId === req) {
      scripts.value = [];
      scriptsCwd.value = null;
    }
  } finally {
    if (reqId === req) loading.value = false;
  }
}

function onOutside(e: PointerEvent) {
  if (rootRef.value && !rootRef.value.contains(e.target as Node)) close();
}
function onEscape(e: KeyboardEvent) {
  if (e.key === "Escape") close();
}

function openMenu() {
  open.value = true;
  loadScripts();
  window.addEventListener("pointerdown", onOutside);
  window.addEventListener("keydown", onEscape);
}
function close() {
  open.value = false;
  window.removeEventListener("pointerdown", onOutside);
  window.removeEventListener("keydown", onEscape);
}
function toggle() {
  if (open.value) close();
  else openMenu();
}

function pick(s: RunnableScript) {
  emit("run", { index: s.index, label: s.label, cwd: scriptsCwd.value ?? props.cwd });
  close();
}

onUnmounted(close);
</script>

<template>
  <div ref="root" class="run-menu">
    <button class="run-trigger" :class="{ active: open }" :aria-expanded="open" aria-haspopup="menu" title="Run a script in a spare terminal" @click="toggle">
      ▶ Run ▾
    </button>
    <div v-if="open" class="run-pop" role="menu">
      <div v-if="loading" class="run-empty">Loading…</div>
      <div v-else-if="!scripts.length" class="run-empty">No scripts (add a script.json)</div>
      <button v-for="s in scripts" :key="s.index" class="run-item" role="menuitem" :title="s.command" @click="pick(s)">▶ {{ s.label }}</button>
    </div>
  </div>
</template>

<style scoped>
.run-menu {
  position: relative;
  display: inline-flex;
}

/* Matches the grid toolbar buttons (.tb-btn lives in GridView's scoped styles). */
.run-trigger {
  border: 1px solid var(--border);
  background: var(--bg-base);
  color: var(--text-secondary);
  font-family: system-ui, sans-serif;
  font-size: 12px;
  line-height: 1;
  padding: 5px 10px;
  border-radius: 6px;
  cursor: pointer;
}
.run-trigger:hover,
.run-trigger.active {
  background: var(--bg-hover);
  color: var(--text);
}

.run-pop {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 20;
  min-width: 180px;
  max-height: 320px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  padding: 4px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
}

.run-item {
  text-align: left;
  border: none;
  background: none;
  color: var(--text-secondary);
  font-family: ui-monospace, "JetBrains Mono", monospace;
  font-size: 12px;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;
}
.run-item:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.run-empty {
  padding: 6px 8px;
  color: var(--text-muted);
  font-family: system-ui, sans-serif;
  font-size: 12px;
  white-space: nowrap;
}
</style>
