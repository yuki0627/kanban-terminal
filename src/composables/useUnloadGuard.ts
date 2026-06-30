import { onMounted, onUnmounted, ref } from "vue";

// How many live terminals the mounted view reports: the single view reports its
// active session (0 or 1), the grid reports its running-cell count. Module-level so
// the guard reads it without prop threading; the two views are mutually exclusive
// (only one is mounted), so whichever is on screen owns the value.
const activeTerminals = ref(0);

export function reportActiveTerminals(count: number): void {
  activeTerminals.value = count;
}

// Warn before the tab closes / reloads / navigates away while a terminal is live,
// so an accidental close doesn't drop sessions (an idle PTY is reaped shortly after
// the socket closes; a working one keeps going, but either way the live view is
// lost). With nothing running, the page closes without a prompt. Install once at the
// app root. The browser shows its own generic confirm dialog — the message text is
// fixed by the browser and can't be customised.
export function useUnloadGuard(): void {
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (activeTerminals.value <= 0) return;
    e.preventDefault();
    e.returnValue = ""; // legacy Chrome/Edge still need returnValue assigned to prompt
  };
  onMounted(() => window.addEventListener("beforeunload", onBeforeUnload));
  onUnmounted(() => window.removeEventListener("beforeunload", onBeforeUnload));
}
