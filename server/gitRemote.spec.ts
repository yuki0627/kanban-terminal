import { describe, it, expect } from "vitest";
import { parseGithubWebUrl } from "./gitRemote.js";

const REPO = "https://github.com/owner/repo";

describe("parseGithubWebUrl", () => {
  it("maps scp-like SSH remotes", () => {
    expect(parseGithubWebUrl("git@github.com:owner/repo.git")).toBe(REPO);
    expect(parseGithubWebUrl("git@github.com:owner/repo")).toBe(REPO);
  });

  it("maps SSH URL remotes, including a port", () => {
    expect(parseGithubWebUrl("ssh://git@github.com/owner/repo.git")).toBe(REPO);
    expect(parseGithubWebUrl("ssh://git@github.com:22/owner/repo.git")).toBe(REPO);
  });

  it("maps HTTPS remotes, with or without .git and credentials", () => {
    expect(parseGithubWebUrl("https://github.com/owner/repo.git")).toBe(REPO);
    expect(parseGithubWebUrl("https://github.com/owner/repo")).toBe(REPO);
    expect(parseGithubWebUrl("https://user:token@github.com/owner/repo.git")).toBe(REPO);
  });

  it("maps the git:// protocol", () => {
    expect(parseGithubWebUrl("git://github.com/owner/repo.git")).toBe(REPO);
  });

  it("trims surrounding whitespace / trailing newline (git output)", () => {
    expect(parseGithubWebUrl("  git@github.com:owner/repo.git\n")).toBe(REPO);
  });

  it("is case-insensitive on the host and strips only a trailing .git", () => {
    expect(parseGithubWebUrl("git@GitHub.com:owner/repo.GIT")).toBe(REPO);
    expect(parseGithubWebUrl("https://github.com/owner/repo.github.git")).toBe("https://github.com/owner/repo.github");
  });

  it("returns null for non-GitHub hosts", () => {
    expect(parseGithubWebUrl("git@gitlab.com:owner/repo.git")).toBeNull();
    expect(parseGithubWebUrl("https://bitbucket.org/owner/repo.git")).toBeNull();
    expect(parseGithubWebUrl("git@github.example.com:owner/repo.git")).toBeNull(); // not github.com
  });

  it("returns null for empty, malformed, or under-specified remotes", () => {
    expect(parseGithubWebUrl("")).toBeNull();
    expect(parseGithubWebUrl("   ")).toBeNull();
    expect(parseGithubWebUrl("not a url")).toBeNull();
    expect(parseGithubWebUrl("https://github.com/owner")).toBeNull(); // no repo segment
    expect(parseGithubWebUrl("https://github.com/")).toBeNull();
  });
});
