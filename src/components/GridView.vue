<script setup lang="ts">
import { ref, onMounted } from "vue";
import TerminalGrid from "./TerminalGrid.vue";
import SettingsModal from "./SettingsModal.vue";
import type { CwdPreset } from "./presets";

// The multi-terminal grid view. Toggled with the classic single view from App.vue.
const emit = defineEmits<{ (e: "exit"): void }>();

// The grid arranges itself by the running-terminal count; the toolbar "+" (wired to
// TerminalGrid via this ref) adds one launch cell, and add-state drives its button.
const gridRef = ref<InstanceType<typeof TerminalGrid> | null>(null);
const addState = ref<{ canAdd: boolean; adding: boolean }>({ canAdd: true, adding: false });

// Server config: the default workspace dir + the user's directory presets.
const defaultCwd = ref<string | null>(null);
const home = ref<string | null>(null);
const presets = ref<CwdPreset[]>([]);
const showSettings = ref(false);
const savingSettings = ref(false);
const settingsError = ref<string | null>(null);

async function loadConfig() {
  try {
    const res = await fetch("/api/config");
    if (!res.ok) return;
    const c = await res.json();
    defaultCwd.value = c.cwd ?? null;
    home.value = c.home ?? null;
    presets.value = Array.isArray(c.cwdPresets) ? c.cwdPresets : [];
  } catch {
    // grid still works; presets just unavailable
  }
}
onMounted(loadConfig);

async function savePresets(next: CwdPreset[]) {
  savingSettings.value = true;
  settingsError.value = null;
  try {
    const res = await fetch("/api/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwdPresets: next }),
    });
    if (!res.ok) throw new Error(`save failed (${res.status})`);
    presets.value = (await res.json()).cwdPresets ?? [];
    showSettings.value = false; // close only on success — keep edits otherwise
  } catch {
    settingsError.value = "Couldn't save presets. Check the server and try again.";
  } finally {
    savingSettings.value = false;
  }
}

function closeSettings() {
  showSettings.value = false;
  settingsError.value = null;
}
</script>

<template>
  <div class="shell">
    <header class="toolbar">
      <span class="toolbar-title">MulmoTerminal</span>
      <button
        class="tb-btn tb-add"
        :class="{ active: addState.adding }"
        :disabled="!addState.canAdd && !addState.adding"
        :title="addState.adding ? 'Cancel adding a terminal' : 'New terminal'"
        @click="gridRef?.addCell()"
      >
        ＋ Terminal
      </button>
      <button class="tb-btn" title="Single view" aria-label="Switch to single view" @click="emit('exit')">▢ Single</button>
      <button class="tb-btn" title="Settings" aria-label="Settings" @click="showSettings = true">⚙</button>
    </header>
    <TerminalGrid ref="gridRef" class="main" :default-cwd="defaultCwd" :presets="presets" :home="home" @add-state="addState = $event" />
    <SettingsModal v-if="showSettings" :presets="presets" :saving="savingSettings" :error="settingsError" @save="savePresets" @close="closeSettings" />
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

.tb-add {
  margin-left: auto;
}
.tb-add:disabled {
  opacity: 0.4;
  cursor: default;
}
.tb-add.active {
  background: #2a3b66;
  color: #fff;
  border-color: #4a8cff;
}

.tb-btn {
  border: 1px solid #2a2a4e;
  background: #1a1a2e;
  color: #c7cdf0;
  font-family: system-ui, sans-serif;
  font-size: 12px;
  line-height: 1;
  padding: 5px 10px;
  border-radius: 6px;
  cursor: pointer;
}
.tb-btn:hover {
  background: #2a3b66;
  color: #fff;
}

.main {
  flex: 1;
  min-height: 0;
  min-width: 0;
}
</style>
