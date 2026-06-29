// Per-directory overrides read from <cwd>/.mulmoterminal.json: a terminal opened in
// a directory can carry its own xterm palette, a badge label/color, and an attention
// sound. Every field is optional; a missing or malformed file yields all-null so the
// terminal falls back to the global theme/sound. Extracted so the sanitize/confine
// logic is unit-testable and the path-confinement check (the security surface) has a
// clear home.
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// Mirrors the theme ids in src/composables/useTheme.ts. The server can't import the
// Vue composable, so the whitelist is duplicated here — keep the two in sync.
export type ThemeId = "midnight" | "nord" | "daylight" | "solarized";
const THEME_IDS: readonly ThemeId[] = ["midnight", "nord", "daylight", "solarized"];

const DIR_CONFIG_FILE = ".mulmoterminal.json";
const NAME_MAX_CHARS = 40;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
// xterm accepts #rgb / #rgba / #rrggbb / #rrggbbaa for palette colors.
const PALETTE_COLOR_RE = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

// The xterm ITheme keys a `colors` block may override (mirrors @xterm/xterm's
// ITheme). Anything outside this set is dropped so an arbitrary JSON object can't
// inject unexpected keys into the terminal options.
const THEME_COLOR_KEYS: readonly string[] = [
  "foreground",
  "background",
  "cursor",
  "cursorAccent",
  "selectionBackground",
  "selectionForeground",
  "selectionInactiveBackground",
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
];

export interface DirConfig {
  name: string | null;
  badgeColor: string | null;
  theme: ThemeId | null;
  // Per-key xterm palette overrides (on top of `theme`), or null when none are valid.
  colors: Record<string, string> | null;
  // Absolute path to the attention sound, resolved within cwd; null when unset or the
  // configured path is absolute / escapes the directory / doesn't exist.
  sound: string | null;
}

// What the browser receives: the raw sound path stays server-side (streamed via
// /api/dir-sound), so the client only learns whether one exists.
export interface PublicDirConfig {
  name: string | null;
  badgeColor: string | null;
  theme: ThemeId | null;
  colors: Record<string, string> | null;
  hasSound: boolean;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isThemeId = (v: unknown): v is ThemeId => typeof v === "string" && THEME_IDS.some((id) => id === v);

function sanitizeName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  return trimmed ? trimmed.slice(0, NAME_MAX_CHARS) : null;
}

function sanitizeColor(input: unknown): string | null {
  return typeof input === "string" && HEX_COLOR_RE.test(input.trim()) ? input.trim().toLowerCase() : null;
}

// Keep only known ITheme keys whose value is a valid palette color; drop the rest.
// null when nothing valid remains, so an empty/garbage block behaves like "unset".
function sanitizeColors(input: unknown): Record<string, string> | null {
  if (!isRecord(input)) return null;
  const out: Record<string, string> = {};
  for (const key of THEME_COLOR_KEYS) {
    const value = input[key];
    if (typeof value === "string" && PALETTE_COLOR_RE.test(value.trim())) out[key] = value.trim().toLowerCase();
  }
  return Object.keys(out).length ? out : null;
}

// Confine the configured sound to a real file INSIDE cwd. Relative paths only;
// anything absolute or escaping via "../" is rejected so an opened project can't
// point the player at arbitrary files on disk. (path.resolve doesn't follow
// symlinks — acceptable here: cwd is the user's own project dir, not hostile input.)
export function resolveDirSound(cwd: string, input: unknown): string | null {
  if (typeof input !== "string") return null;
  const rel = input.trim();
  if (!rel || path.isAbsolute(rel)) return null;
  const base = path.resolve(cwd);
  const resolved = path.resolve(base, rel);
  const withinBase = resolved === base || resolved.startsWith(base + path.sep);
  if (!withinBase) return null;
  return existsSync(resolved) && statSync(resolved).isFile() ? resolved : null;
}

const EMPTY: DirConfig = { name: null, badgeColor: null, theme: null, colors: null, sound: null };

export function loadDirConfig(cwd: string): DirConfig {
  try {
    const base = path.resolve(cwd);
    const file = path.join(base, DIR_CONFIG_FILE);
    if (!existsSync(file)) return EMPTY;
    const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!isRecord(raw)) return EMPTY;
    return {
      name: sanitizeName(raw.name),
      badgeColor: sanitizeColor(raw.badgeColor),
      theme: isThemeId(raw.theme) ? raw.theme : null,
      colors: sanitizeColors(raw.colors),
      sound: resolveDirSound(base, raw.sound),
    };
  } catch {
    return EMPTY;
  }
}

export function publicDirConfig(cwd: string): PublicDirConfig {
  const { name, badgeColor, theme, colors, sound } = loadDirConfig(cwd);
  return { name, badgeColor, theme, colors, hasSound: sound !== null };
}

export function dirSoundFile(cwd: string): string | null {
  return loadDirConfig(cwd).sound;
}
