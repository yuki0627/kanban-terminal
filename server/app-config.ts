// The app config persisted at ~/.kanban-terminal/config.json: the user's directory
// presets plus an optional custom attention-sound file. Unified read/write so a
// partial update (e.g. just the sound) never clobbers the other field. Extracted
// from config-routes.ts so the sanitize/load/save logic is unit-testable.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { sanitizePresets, type CwdPreset } from "./cwd-presets.js";

// A named program a grid cell can launch instead of Claude (a plain shell, codex,
// any interactive command). `command` is run on the user's own machine as an
// interactive persistent PTY — it's their own config, so it's an intentional allowlist.
export interface Launcher {
  label: string;
  command: string;
}

export interface AppConfig {
  cwdPresets: CwdPreset[];
  // Absolute path to a user-supplied audio file played as the attention sound, or
  // null to use the built-in synthesized chime (the default — no bundled asset).
  soundFile: string | null;
  // User-defined launch commands offered in the grid cell launcher (label + command).
  launchers: Launcher[];
}

const LAUNCHER_LABEL_MAX = 40;
const LAUNCHER_COMMAND_MAX = 500;
const LAUNCHERS_MAX = 20;

// Keep entries with a non-empty label AND command (trimmed, length-capped), drop
// duplicate labels, cap the count. Labels are what the UI shows and what a persisted
// cell resolves back to, so they must be unique.
export function sanitizeLaunchers(input: unknown): Launcher[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: Launcher[] = [];
  for (const v of input) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const label = typeof o.label === "string" ? o.label.trim().slice(0, LAUNCHER_LABEL_MAX) : "";
    const command = typeof o.command === "string" ? o.command.trim().slice(0, LAUNCHER_COMMAND_MAX) : "";
    if (!label || !command || seen.has(label)) continue;
    seen.add(label);
    out.push({ label, command });
    if (out.length >= LAUNCHERS_MAX) break;
  }
  return out;
}

// Keep only a non-empty ABSOLUTE path; anything else (relative, blank, non-string)
// clears the custom sound. Absolute-only matches the documented contract and stops
// /api/sound from resolving a relative value against the server's cwd.
export function sanitizeSoundFile(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  return trimmed && path.isAbsolute(trimmed) ? trimmed : null;
}

// Fresh object each call — callers hold and mutate the returned config in place, so a
// shared default constant would be corrupted across loads.
const emptyConfig = (): AppConfig => ({ cwdPresets: [], soundFile: null, launchers: [] });

export function loadAppConfig(file: string): AppConfig {
  try {
    if (!existsSync(file)) return emptyConfig();
    const raw = JSON.parse(readFileSync(file, "utf8"));
    return {
      cwdPresets: sanitizePresets(raw?.cwdPresets),
      soundFile: sanitizeSoundFile(raw?.soundFile),
      launchers: sanitizeLaunchers(raw?.launchers),
    };
  } catch {
    return emptyConfig();
  }
}

// Persist the whole config; returns false on any write failure so the caller can
// surface it instead of reporting a false success.
export function saveAppConfig(file: string, config: AppConfig): boolean {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    const payload = {
      cwdPresets: config.cwdPresets,
      soundFile: config.soundFile,
      launchers: config.launchers,
    };
    writeFileSync(file, JSON.stringify(payload, null, 2));
    return true;
  } catch {
    return false;
  }
}
