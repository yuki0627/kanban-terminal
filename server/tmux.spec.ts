import { describe, it, expect, beforeEach, vi } from "vitest";

const spawnSyncMock = vi.hoisted(() => vi.fn());

vi.mock(import("node:child_process"), async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    default: { ...actual, spawnSync: spawnSyncMock },
    spawnSync: spawnSyncMock,
  };
});

import { tmuxConfigLines, tmuxSessionName, tmuxNewSessionArgs, tmuxListSessionIds, tmuxPaneCurrentCommand, tmuxPanePid } from "./tmux";

function mockTmuxResult(status: number | null, stdout: string): void {
  spawnSyncMock.mockReturnValue({ status, stdout });
}

beforeEach(() => {
  spawnSyncMock.mockReset();
});

describe("tmuxConfigLines", () => {
  it("clears inherited NO_COLOR for the isolated tmux server", () => {
    expect(tmuxConfigLines()).toContain("set-environment -gu NO_COLOR");
  });
});

describe("tmuxSessionName", () => {
  it("prefixes the session id", () => {
    expect(tmuxSessionName("abc-123")).toBe("kt-abc-123");
  });
});

describe("tmuxNewSessionArgs", () => {
  const args = tmuxNewSessionArgs("id1", "/bin/zsh", ["-lc", "exec codex"], "/proj");

  it("targets our isolated tmux server and config", () => {
    expect(args.slice(0, 4)).toEqual(["-L", "kanban-terminal", "-f", expect.stringMatching(/tmux\.conf$/)]);
  });
  it("uses new-session -A (create-or-attach) with the kt- session name and cwd", () => {
    expect(args).toContain("new-session");
    expect(args).toContain("-A");
    expect(args[args.indexOf("-s") + 1]).toBe("kt-id1");
    expect(args[args.indexOf("-c") + 1]).toBe("/proj");
  });
  it("passes the program + its args after `--` (so flags aren't parsed by tmux)", () => {
    const dashdash = args.indexOf("--");
    expect(dashdash).toBeGreaterThan(0);
    expect(args.slice(dashdash + 1)).toEqual(["/bin/zsh", "-lc", "exec codex"]);
  });
});

describe("tmuxListSessionIds", () => {
  it("returns [] when tmux cannot list sessions", () => {
    mockTmuxResult(1, "kt-stale\n");

    expect(tmuxListSessionIds()).toEqual([]);
  });

  it("keeps only kt-prefixed sessions and strips the prefix", () => {
    mockTmuxResult(0, "kt-alpha\nuser-session\nkt-beta\n\nkt-\n");

    expect(tmuxListSessionIds()).toEqual(["alpha", "beta", ""]);
  });
});

describe("tmuxPaneCurrentCommand", () => {
  it("returns null when tmux cannot inspect the pane", () => {
    mockTmuxResult(1, "zsh\n");

    expect(tmuxPaneCurrentCommand("missing")).toBeNull();
  });

  it("trims the pane command from tmux output", () => {
    mockTmuxResult(0, " node \n");

    expect(tmuxPaneCurrentCommand("id1")).toBe("node");
  });
});

describe("tmuxPanePid", () => {
  it("returns null when tmux cannot inspect the pane", () => {
    mockTmuxResult(1, "12345\n");

    expect(tmuxPanePid("missing")).toBeNull();
  });

  it("returns null for non-numeric pane pid output", () => {
    mockTmuxResult(0, "not-a-pid\n");

    expect(tmuxPanePid("id1")).toBeNull();
  });

  it("parses the pane pid from tmux output", () => {
    mockTmuxResult(0, "12345\n");

    expect(tmuxPanePid("id1")).toBe(12345);
  });
});
