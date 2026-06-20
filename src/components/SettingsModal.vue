<script setup lang="ts">
import { ref } from "vue";
import type { CwdPreset } from "./presets";

const props = defineProps<{ presets: CwdPreset[] }>();
const emit = defineEmits<{ (e: "save", presets: CwdPreset[]): void; (e: "close"): void }>();

// Edit a local copy; commit on Save.
const rows = ref<CwdPreset[]>(props.presets.map((p) => ({ ...p })));

function addRow() {
  rows.value.push({ label: "", path: "" });
}
function removeRow(i: number) {
  rows.value.splice(i, 1);
}
function save() {
  const cleaned = rows.value.map((r) => ({ label: r.label.trim(), path: r.path.trim() })).filter((r) => r.label && r.path);
  emit("save", cleaned);
}
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="modal" role="dialog" aria-modal="true" aria-label="Settings">
      <div class="modal-head">
        <h2 class="modal-title">Directory presets</h2>
        <button class="icon-btn" title="Close" aria-label="Close settings" @click="emit('close')">✕</button>
      </div>
      <p class="hint">Quick-pick directories offered when launching a terminal.</p>

      <div class="rows">
        <div v-for="(row, i) in rows" :key="i" class="row">
          <input v-model="row.label" class="field label-field" type="text" placeholder="Label" spellcheck="false" />
          <input v-model="row.path" class="field path-field" type="text" placeholder="/absolute/path" spellcheck="false" />
          <button class="icon-btn" title="Remove" aria-label="Remove preset" @click="removeRow(i)">✕</button>
        </div>
        <p v-if="rows.length === 0" class="empty">No presets yet.</p>
      </div>

      <div class="modal-foot">
        <button class="btn" @click="addRow">＋ Add preset</button>
        <span class="spacer" />
        <button class="btn" @click="emit('close')">Cancel</button>
        <button class="btn btn-primary" @click="save">Save</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.modal {
  width: min(560px, 92vw);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  background: #1a1a2e;
  border: 1px solid #2a2a4e;
  border-radius: 10px;
  padding: 16px;
  color: #e6e6f0;
  font-family: system-ui, sans-serif;
}
.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.modal-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.hint {
  margin: 6px 0 12px;
  font-size: 12px;
  color: #8b93b8;
}
.rows {
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.field {
  box-sizing: border-box;
  padding: 7px 10px;
  background: #11111f;
  border: 1px solid #2a2a4e;
  border-radius: 6px;
  color: #e6e6f0;
  font-size: 12px;
}
.field:focus {
  outline: none;
  border-color: #4a8cff;
}
.label-field {
  flex: 0 0 30%;
}
.path-field {
  flex: 1 1 auto;
  font-family: ui-monospace, "JetBrains Mono", monospace;
}
.empty {
  font-size: 12px;
  color: #6b7394;
}
.modal-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
}
.spacer {
  flex: 1;
}
.icon-btn {
  border: none;
  background: transparent;
  color: #9aa3c0;
  cursor: pointer;
  font-size: 14px;
  padding: 4px 6px;
  border-radius: 6px;
}
.icon-btn:hover {
  background: #3a2030;
  color: #ff6b6b;
}
.btn {
  border: 1px solid #2a2a4e;
  background: #20203a;
  color: #c7cdf0;
  cursor: pointer;
  font-size: 13px;
  padding: 6px 14px;
  border-radius: 6px;
}
.btn:hover {
  background: #2a3b66;
  color: #fff;
}
.btn-primary {
  background: #2f5bd0;
  border-color: #4a8cff;
  color: #fff;
}
.btn-primary:hover {
  background: #3a6be0;
}
</style>
