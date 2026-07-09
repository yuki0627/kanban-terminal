// Group archived cards for the archive panel: by owning project (an explicit
// projectId, or inferred from the terminal cwd sitting under a project root),
// otherwise by the original working directory, with a trailing bucket for
// cards that have no cwd or whose cwd is the home directory itself.

import { homeRelative } from "./cwdDisplay";
import type { KanbanCard, Project } from "./kanbanBoard";

export type ArchiveGroupKind = "project" | "directory" | "none";

export interface ArchiveGroup {
  key: string;
  kind: ArchiveGroupKind;
  label: string;
  color: string | null;
  cards: KanbanCard[];
}

// Matches the "Projectなし" wording of the projects sidebar.
export const NO_PROJECT_LABEL = "Projectなし";

// Windows paths use "\" and are case-insensitive (incl. the drive letter);
// same convention as homeRelative in cwdDisplay.ts.
const isWindowsPath = (p: string): boolean => p.includes("\\") || /^[a-zA-Z]:/.test(p);
const stripTrailingSep = (p: string): string => {
  let end = p.length;
  while (end > 0 && (p[end - 1] === "/" || p[end - 1] === "\\")) end--;
  return p.slice(0, end);
};

// cwd must continue with a separator right after the root (so ~/p/alpha
// doesn't claim ~/p/alpha-two); see homeRelative for the same rule.
function underRoot(cwd: string, root: string): boolean {
  const base = stripTrailingSep(root);
  // A project with an empty (or bare-"/") root must not swallow every card.
  if (!base) return false;
  const windows = isWindowsPath(base) || isWindowsPath(cwd);
  const a = windows ? cwd.toLowerCase() : cwd;
  const b = windows ? base.toLowerCase() : base;
  if (a === b) return true;
  const next = a.charAt(b.length);
  return (next === "/" || next === "\\") && a.startsWith(b);
}

function projectForCwd(cwd: string | null, projects: ReadonlyArray<Project>): Project | null {
  if (!cwd) return null;
  let best: Project | null = null;
  for (const p of projects) {
    if (underRoot(cwd, p.root) && (best === null || p.root.length > best.root.length)) best = p;
  }
  return best;
}

export function buildArchiveGroups(cards: ReadonlyArray<KanbanCard>, projects: ReadonlyArray<Project>, home: string | null): ArchiveGroup[] {
  const byKey = new Map<string, ArchiveGroup>();
  const add = (key: string, kind: ArchiveGroupKind, label: string, color: string | null, card: KanbanCard) => {
    const group = byKey.get(key) ?? { key, kind, label, color, cards: [] };
    group.cards.push(card);
    byKey.set(key, group);
  };

  for (const card of cards) {
    const byId = card.projectId ? (projects.find((p) => p.id === card.projectId) ?? null) : null;
    const project = byId ?? projectForCwd(card.terminal.cwd, projects);
    if (project) {
      add(`project:${project.id}`, "project", project.name, project.color, card);
      continue;
    }
    // Canonicalize the directory key so "~/docs/" and (on Windows) case
    // variants land in one group; the label keeps the first-seen spelling.
    const cwd = card.terminal.cwd ? stripTrailingSep(card.terminal.cwd) || card.terminal.cwd : null;
    const label = cwd ? homeRelative(cwd, home) : "~";
    if (!cwd || label === "~") {
      add("none", "none", NO_PROJECT_LABEL, null, card);
    } else {
      add(`dir:${isWindowsPath(cwd) ? cwd.toLowerCase() : cwd}`, "directory", label, null, card);
    }
  }

  const orderOf = new Map(projects.map((p) => [`project:${p.id}`, p.order]));
  const rank: Record<ArchiveGroupKind, number> = { project: 0, directory: 1, none: 2 };
  return [...byKey.values()].sort((a, b) => {
    if (a.kind !== b.kind) return rank[a.kind] - rank[b.kind];
    if (a.kind === "project") return (orderOf.get(a.key) ?? 0) - (orderOf.get(b.key) ?? 0);
    // Directory keys embed the raw path — compare them (not the "~" label,
    // whose shortening would scramble home vs non-home ordering).
    if (a.key < b.key) return -1;
    return a.key > b.key ? 1 : 0;
  });
}
