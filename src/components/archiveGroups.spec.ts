import { describe, it, expect } from "vitest";
import { buildArchiveGroups, NO_PROJECT_LABEL } from "./archiveGroups";
import type { KanbanCard, Project } from "./kanbanBoard";

const HOME = "/Users/me";

const project = (over: Partial<Project> = {}): Project => ({
  id: "p1",
  root: `${HOME}/projects/alpha`,
  name: "alpha",
  color: "#2563eb",
  sidebarVisible: true,
  order: 0,
  ...over,
});

const card = (over: Partial<KanbanCard> = {}, cwd: string | null = null): KanbanCard => ({
  id: "c1",
  projectId: null,
  name: "card",
  memo: "",
  lane: "todo",
  archived: true,
  unread: false,
  terminal: { sessionId: null, agentKind: "shell", cwd, agentSessionId: null },
  overlay: null,
  memoPanel: null,
  createdAt: 1,
  updatedAt: 2,
  manual: false,
  lastStatus: "idle",
  ...over,
});

describe("buildArchiveGroups", () => {
  it("returns no groups for no cards", () => {
    expect(buildArchiveGroups([], [project()], HOME)).toEqual([]);
  });

  it("groups cards under their project by projectId, keeping the project color and name", () => {
    const p = project();
    const groups = buildArchiveGroups([card({ id: "c1", projectId: "p1" })], [p], HOME);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: "project:p1", kind: "project", label: "alpha", color: "#2563eb" });
    expect(groups[0].cards.map((c) => c.id)).toEqual(["c1"]);
  });

  it("orders project groups by project order and omits projects with no archived cards", () => {
    const projects = [project({ id: "p2", name: "beta", order: 1 }), project({ id: "p1", name: "alpha", order: 0 }), project({ id: "p3", order: 2 })];
    const cards = [card({ id: "c1", projectId: "p2" }), card({ id: "c2", projectId: "p1" })];
    expect(buildArchiveGroups(cards, projects, HOME).map((g) => g.key)).toEqual(["project:p1", "project:p2"]);
  });

  it("attributes a projectless card to a project when its cwd is the project root or inside it", () => {
    const p = project();
    const cards = [card({ id: "c1" }, p.root), card({ id: "c2" }, `${p.root}/src/deep`)];
    const groups = buildArchiveGroups(cards, [p], HOME);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("project:p1");
    expect(groups[0].cards.map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  it("does not attribute by mere path-prefix without a separator (alpha vs alpha-two)", () => {
    const groups = buildArchiveGroups([card({ id: "c1" }, `${HOME}/projects/alpha-two`)], [project()], HOME);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ kind: "directory", label: "~/projects/alpha-two" });
  });

  it("attributes to the most specific (longest) project root when roots nest", () => {
    const outer = project({ id: "outer", root: `${HOME}/mono`, order: 0 });
    const inner = project({ id: "inner", root: `${HOME}/mono/pkg`, order: 1 });
    const groups = buildArchiveGroups([card({ id: "c1" }, `${HOME}/mono/pkg/src`)], [outer, inner], HOME);
    expect(groups.map((g) => g.key)).toEqual(["project:inner"]);
  });

  it("groups the remaining cards by cwd directory with a home-relative label, sorted by path", () => {
    const cards = [card({ id: "c1" }, `${HOME}/tmp/zeta`), card({ id: "c2" }, `${HOME}/docs`), card({ id: "c3" }, `${HOME}/docs`)];
    const groups = buildArchiveGroups(cards, [], HOME);
    expect(groups.map((g) => [g.key, g.label])).toEqual([
      [`dir:${HOME}/docs`, "~/docs"],
      [`dir:${HOME}/tmp/zeta`, "~/tmp/zeta"],
    ]);
    expect(groups[0].cards.map((c) => c.id)).toEqual(["c2", "c3"]);
    expect(groups[0]).toMatchObject({ kind: "directory", color: null });
  });

  it("puts cards with no cwd or with cwd equal to home into the trailing no-project group", () => {
    const cards = [card({ id: "c1" }, null), card({ id: "c2" }, HOME), card({ id: "c3" }, `${HOME}/docs`)];
    const groups = buildArchiveGroups(cards, [], HOME);
    expect(groups.map((g) => g.kind)).toEqual(["directory", "none"]);
    const none = groups[1];
    expect(none).toMatchObject({ key: "none", label: NO_PROJECT_LABEL, color: null });
    expect(none.cards.map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  it("orders groups as projects, then directories, then no-project", () => {
    const p = project();
    const cards = [card({ id: "c1" }, null), card({ id: "c2" }, `${HOME}/docs`), card({ id: "c3", projectId: "p1" })];
    expect(buildArchiveGroups(cards, [p], HOME).map((g) => g.kind)).toEqual(["project", "directory", "none"]);
  });

  it("keeps board order of cards inside each group", () => {
    const cards = [card({ id: "c2", projectId: "p1" }), card({ id: "c1", projectId: "p1" })];
    expect(buildArchiveGroups(cards, [project()], HOME)[0].cards.map((c) => c.id)).toEqual(["c2", "c1"]);
  });

  it("still groups by raw cwd when home is unknown", () => {
    const groups = buildArchiveGroups([card({ id: "c1" }, "/srv/app")], [], null);
    expect(groups[0]).toMatchObject({ kind: "directory", key: "dir:/srv/app", label: "/srv/app" });
  });

  it("falls back to cwd attribution when projectId points at a deleted project", () => {
    const p = project();
    const cards = [card({ id: "c1", projectId: "ghost" }, `${p.root}/src`), card({ id: "c2", projectId: "ghost" }, null)];
    const groups = buildArchiveGroups(cards, [p], HOME);
    expect(groups.map((g) => g.kind)).toEqual(["project", "none"]);
    expect(groups[0].cards.map((c) => c.id)).toEqual(["c1"]);
  });

  it("matches project roots case-insensitively for Windows paths", () => {
    const p = project({ root: "C:\\Users\\me\\Proj" });
    const groups = buildArchiveGroups([card({ id: "c1" }, "c:\\users\\me\\proj\\sub")], [p], "C:\\Users\\me");
    expect(groups.map((g) => g.key)).toEqual(["project:p1"]);
  });

  it("merges Windows directory groups that differ only in case", () => {
    const cards = [card({ id: "c1" }, "C:\\Work\\App"), card({ id: "c2" }, "c:\\work\\app")];
    const groups = buildArchiveGroups(cards, [], "C:\\Users\\me");
    expect(groups).toHaveLength(1);
    expect(groups[0].cards.map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  it("tolerates a trailing separator on the project root", () => {
    const p = project({ root: `${HOME}/projects/alpha/` });
    const groups = buildArchiveGroups([card({ id: "c1" }, `${HOME}/projects/alpha/src`)], [p], HOME);
    expect(groups.map((g) => g.key)).toEqual(["project:p1"]);
  });

  it("never lets a project with an empty root swallow cards", () => {
    const p = project({ id: "broken", root: "", name: "" });
    const groups = buildArchiveGroups([card({ id: "c1" }, `${HOME}/docs`)], [p], HOME);
    expect(groups.map((g) => g.kind)).toEqual(["directory"]);
  });

  it("merges directory groups that differ only by a trailing separator", () => {
    const cards = [card({ id: "c1" }, `${HOME}/docs`), card({ id: "c2" }, `${HOME}/docs/`)];
    const groups = buildArchiveGroups(cards, [], HOME);
    expect(groups).toHaveLength(1);
    expect(groups[0].cards.map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  it("orders directory groups by raw path, not by the home-shortened label", () => {
    const cards = [card({ id: "c1" }, "/srv/app"), card({ id: "c2" }, `${HOME}/docs`)];
    const groups = buildArchiveGroups(cards, [], HOME);
    // Raw-path order: /Users/me/docs < /srv/app, even though the "~/docs" label sorts after "/srv/app".
    expect(groups.map((g) => g.label)).toEqual(["~/docs", "/srv/app"]);
  });
});
