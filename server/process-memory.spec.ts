import { describe, it, expect } from "vitest";
import { parsePsCommandRows, parsePsRows, processTreeRows, sumProcessTreeRss } from "./process-memory.js";

describe("process memory helpers", () => {
  it("parses ps rows and sums a process tree", () => {
    const rows = parsePsRows(`
      10 1 100
      11 10 25
      12 10 50
      13 11 5
      99 1 1000
    `);
    expect(sumProcessTreeRss(rows, 10)).toBe(180);
  });

  it("parses process command rows without losing arguments", () => {
    expect(parsePsCommandRows("  10     1 node /usr/local/bin/claude --foo\n  11    10 zsh\n")).toEqual([
      { pid: 10, ppid: 1, args: "node /usr/local/bin/claude --foo" },
      { pid: 11, ppid: 10, args: "zsh" },
    ]);
  });

  it("returns the root process and descendants", () => {
    const rows = [
      { pid: 1, ppid: 0, args: "root" },
      { pid: 2, ppid: 1, args: "child" },
      { pid: 3, ppid: 2, args: "grandchild" },
      { pid: 4, ppid: 0, args: "other" },
    ];
    expect(
      processTreeRows(rows, 1)
        .map((row) => row.pid)
        .sort(),
    ).toEqual([1, 2, 3]);
  });
});
