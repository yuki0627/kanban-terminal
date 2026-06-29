import { ref, watch, type Ref } from "vue";
import { isThemeId, type ThemeId } from "./useTheme";

// The per-directory overrides a terminal adopts when its cwd holds a
// `.mulmoterminal.json` (served by GET /api/dir-config). The raw sound path stays
// server-side; `hasSound` says whether GET /api/dir-sound has something to stream.
export interface DirConfig {
  name: string | null;
  badgeColor: string | null;
  theme: ThemeId | null;
  hasSound: boolean;
}

const EMPTY: DirConfig = { name: null, badgeColor: null, theme: null, hasSound: false };

// One fetch per cwd, shared across cells: several terminals in the same directory
// resolve to one request, and the config is stable for the page's lifetime (changes
// to the file take effect on the next page load — MVP, no live watch).
const cache = new Map<string, Promise<DirConfig>>();

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function parse(c: unknown): DirConfig {
  if (!isRecord(c)) return EMPTY;
  return {
    name: typeof c.name === "string" ? c.name : null,
    badgeColor: typeof c.badgeColor === "string" ? c.badgeColor : null,
    theme: isThemeId(c.theme) ? c.theme : null,
    hasSound: c.hasSound === true,
  };
}

export function fetchDirConfig(cwd: string): Promise<DirConfig> {
  const cached = cache.get(cwd);
  if (cached) return cached;
  const pending = (async () => {
    try {
      const res = await fetch(`/api/dir-config?cwd=${encodeURIComponent(cwd)}`);
      return res.ok ? parse(await res.json()) : EMPTY;
    } catch {
      return EMPTY;
    }
  })();
  cache.set(cwd, pending);
  return pending;
}

// Reactive dir config for a (possibly changing) cwd. Resets to empty while no cwd is
// set so a cell that switches directories never shows a stale badge/theme.
export function useDirConfig(cwd: Ref<string | null | undefined>) {
  const config = ref<DirConfig>(EMPTY);
  watch(
    cwd,
    async (c) => {
      if (!c) {
        config.value = EMPTY;
        return;
      }
      const resolved = await fetchDirConfig(c);
      if (cwd.value === c) config.value = resolved; // ignore a stale resolve after a fast switch
    },
    { immediate: true },
  );
  return { config };
}
