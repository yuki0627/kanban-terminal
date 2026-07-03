// The app config persisted at ~/.mulmoterminal/config.json: the user's directory
// presets plus an optional custom attention-sound file. Unified read/write so a
// partial update (e.g. just the sound) never clobbers the other field. Extracted
// from config-routes.ts so the sanitize/load/save logic is unit-testable.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { sanitizePresets, type CwdPreset } from "./cwd-presets.js";

export interface AppConfig {
  cwdPresets: CwdPreset[];
  // Absolute path to a user-supplied audio file played as the attention sound, or
  // null to use the built-in synthesized chime (the default — no bundled asset).
  soundFile: string | null;
  // GitHub repos ("owner/repo") whose open PRs the cross-repo PR view aggregates.
  prRepos: string[];
}

// "owner/repo" only — the value is passed to `gh pr list --repo`, so reject anything
// that isn't a plain slug (no spaces, flags, or paths). Trimmed, de-duplicated.
const REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
export function sanitizeRepos(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  for (const v of input) {
    if (typeof v !== "string") continue;
    const r = v.trim();
    if (REPO_RE.test(r)) seen.add(r);
  }
  return [...seen];
}

// Keep only a non-empty ABSOLUTE path; anything else (relative, blank, non-string)
// clears the custom sound. Absolute-only matches the documented contract and stops
// /api/sound from resolving a relative value against the server's cwd.
export function sanitizeSoundFile(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  return trimmed && path.isAbsolute(trimmed) ? trimmed : null;
}

export function loadAppConfig(file: string): AppConfig {
  try {
    if (!existsSync(file)) return { cwdPresets: [], soundFile: null, prRepos: [] };
    const raw = JSON.parse(readFileSync(file, "utf8"));
    return { cwdPresets: sanitizePresets(raw?.cwdPresets), soundFile: sanitizeSoundFile(raw?.soundFile), prRepos: sanitizeRepos(raw?.prRepos) };
  } catch {
    return { cwdPresets: [], soundFile: null, prRepos: [] };
  }
}

// Persist the whole config; returns false on any write failure so the caller can
// surface it instead of reporting a false success.
export function saveAppConfig(file: string, config: AppConfig): boolean {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ cwdPresets: config.cwdPresets, soundFile: config.soundFile, prRepos: config.prRepos }, null, 2));
    return true;
  } catch {
    return false;
  }
}
