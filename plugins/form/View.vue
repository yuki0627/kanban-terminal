<script setup lang="ts">
import { reactive, ref, computed, watch } from "vue";

// Plugin viewComponent for presentForm. High-fidelity contract: `selectedResult`
// is the toolResult; on submit we build a readable summary and TYPE IT INTO THE
// PTY via `sendTextMessage` (the same GUI->LLM path MulmoClaude uses) — there is
// no blocking round-trip. We persist the submitted state via `updateResult` so a
// later history replay shows the form already completed.
interface Field {
  name: string;
  label?: string;
  // "text" (default) | "textarea" | "number" | "select"; kept as string so the
  // schema from the server assigns without friction.
  type?: string;
  options?: string[];
  placeholder?: string;
  required?: boolean;
}
interface FormData {
  title?: string;
  fields: Field[];
  submitLabel?: string;
}
interface ViewState {
  values?: Record<string, string>;
  submitted?: boolean;
}
interface ToolResult {
  uuid: string;
  toolName: string;
  data: FormData;
  viewState?: ViewState;
}

const props = defineProps<{
  selectedResult: ToolResult;
  // Returns whether the answer was actually delivered to the PTY.
  sendTextMessage: (text: string) => boolean;
}>();
const emit = defineEmits<{ updateResult: [result: ToolResult] }>();

const form = computed(() => props.selectedResult.data);
const values = reactive<Record<string, string>>({});
const submitted = ref(false);
const error = ref<string | null>(null);

// Seed values from the field schema, and from prior viewState when replaying an
// already-submitted form.
function seed() {
  const vs = props.selectedResult.viewState;
  for (const f of form.value.fields) {
    const prior = vs?.values?.[f.name];
    values[f.name] = prior != null ? String(prior) : "";
  }
  submitted.value = vs?.submitted ?? false;
}
seed();
// If a different toolResult is rendered into this same component instance, reseed.
watch(() => props.selectedResult.uuid, seed);
// Another viewer submitted this same form: the result is re-published with the
// same uuid (so the uuid watch above won't fire) but viewState.submitted flips.
// Reseed to lock this instance too — guarded so it can't clobber in-progress
// typing on a non-submit update.
watch(
  () => props.selectedResult.viewState?.submitted,
  (s) => {
    if (s && !submitted.value) seed();
  }
);

const locked = () => submitted.value;

function submit() {
  if (locked()) return;
  // Basic required-field check before we commit.
  for (const f of form.value.fields) {
    if (f.required && !values[f.name]?.trim()) {
      error.value = `"${f.label || f.name}" is required.`;
      return;
    }
  }

  // Build a readable summary and type it into the PTY as the next user turn.
  const lines: string[] = [];
  if (form.value.title) lines.push(`**${form.value.title}**`, "");
  for (const f of form.value.fields) {
    lines.push(`- ${f.label || f.name}: ${values[f.name] ?? ""}`);
  }

  // Only lock + persist if the answer actually reached the PTY. If the terminal
  // is disconnected/reconnecting, submitText is a no-op — keep the form editable
  // and surface the failure so the user can retry (Claude never saw it).
  const delivered = props.sendTextMessage(lines.join("\n"));
  if (!delivered) {
    error.value = "Couldn't reach the terminal (is the session connected?). Please try again.";
    return;
  }
  error.value = null;
  submitted.value = true;

  // Persist submitted state so the form replays as completed on revisit.
  emit("updateResult", {
    ...props.selectedResult,
    viewState: { values: { ...values }, submitted: true },
  });
}
</script>

<template>
  <form class="gui-form" @submit.prevent="submit">
    <h3 v-if="form.title" class="form-title">
      {{ form.title }}
    </h3>

    <div v-for="f in form.fields" :key="f.name" class="field">
      <label :for="`${selectedResult.uuid}-${f.name}`">{{ f.label || f.name }}</label>

      <textarea
        v-if="f.type === 'textarea'"
        :id="`${selectedResult.uuid}-${f.name}`"
        v-model="values[f.name]"
        :placeholder="f.placeholder"
        :disabled="locked()"
        rows="3"
      />
      <select
        v-else-if="f.type === 'select'"
        :id="`${selectedResult.uuid}-${f.name}`"
        v-model="values[f.name]"
        :disabled="locked()"
      >
        <option value="" disabled>
          {{ f.placeholder || "Select…" }}
        </option>
        <option v-for="opt in f.options || []" :key="opt" :value="opt">
          {{ opt }}
        </option>
      </select>
      <input
        v-else
        :id="`${selectedResult.uuid}-${f.name}`"
        v-model="values[f.name]"
        :type="f.type === 'number' ? 'number' : 'text'"
        :placeholder="f.placeholder"
        :disabled="locked()"
      >
    </div>

    <div v-if="error" class="form-error">
      {{ error }}
    </div>

    <div class="actions">
      <button type="submit" :disabled="locked()">
        {{ locked() ? "Submitted ✓" : form.submitLabel || "Submit" }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.gui-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.form-title {
  margin: 0;
  font-size: 15px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.field label {
  font-size: 12px;
  color: #9aa5c4;
}

input,
textarea,
select {
  background: #0d1124;
  border: 1px solid #2a2a4e;
  border-radius: 6px;
  color: #e0e0e0;
  padding: 6px 8px;
  font: inherit;
  font-size: 13px;
}
input:focus,
textarea:focus,
select:focus {
  outline: none;
  border-color: #4a8cff;
}
input:disabled,
textarea:disabled,
select:disabled {
  opacity: 0.7;
  cursor: default;
}

.form-error {
  color: #ef9a9a;
  font-size: 12px;
}

.actions {
  display: flex;
  justify-content: flex-end;
}
button {
  background: #1b3a6b;
  color: #cfe0ff;
  border: none;
  border-radius: 6px;
  padding: 7px 14px;
  font-size: 13px;
  cursor: pointer;
}
button:hover:not(:disabled) {
  background: #224a86;
}
button:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
