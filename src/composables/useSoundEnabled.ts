import { ref, watch } from "vue";

// Whether the attention beep is on. A singleton ref shared across both toolbars,
// synced to localStorage so the choice survives reloads. Default on (anything but
// the explicit "0").
const STORAGE_KEY = "sound_enabled";
const enabled = ref(localStorage.getItem(STORAGE_KEY) !== "0");
watch(enabled, (v) => localStorage.setItem(STORAGE_KEY, v ? "1" : "0"));

export function useSoundEnabled() {
  return { enabled, toggle: () => (enabled.value = !enabled.value) };
}
