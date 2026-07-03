// Navigation seam for the full-screen file explorer + editor, a thin derivation over
// vue-router (mirrors usePrsView). The open view is the URL: /files?cwd=<project dir>.
// A terminal header's Files button opens it rooted at that terminal's directory.
import { computed, type ComputedRef } from "vue";
import { router } from "../router";

/** Open the Files view rooted at `cwd` (the terminal's project dir). */
export function filesGotoIndex(cwd: string | null): void {
  router.push({ name: "files", query: cwd ? { cwd } : {} });
}

/** Close the Files view → back to chat. */
export function filesClose(): void {
  router.push("/");
}

export function useFilesView(): { isOpen: ComputedRef<boolean>; cwd: ComputedRef<string | null>; close: () => void } {
  return {
    isOpen: computed(() => router.currentRoute.value.name === "files"),
    // The project dir to browse — the ?cwd= query (a single string; arrays/absent => null).
    cwd: computed(() => {
      const q = router.currentRoute.value.query.cwd;
      return typeof q === "string" ? q : null;
    }),
    close: filesClose,
  };
}
