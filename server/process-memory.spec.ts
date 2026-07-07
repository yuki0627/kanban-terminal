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

  it("drops malformed ps memory rows", () => {
    expect(
      parsePsRows(`
        10 1 100
        not-a-pid 1 200
        11 not-a-ppid 25
        12 10
        single-token
        13 10 50
      `),
    ).toEqual([
      { pid: 10, ppid: 1, rssKb: 100 },
      { pid: 13, ppid: 10, rssKb: 50 },
    ]);
  });

  it("drops malformed ps command rows", () => {
    expect(
      parsePsCommandRows(`
        10 1 node /usr/local/bin/claude --foo
        not-a-pid 1 zsh
        11 not-a-ppid zsh
        12 zsh
        single-token
        13 10 npm run dev -- --host 127.0.0.1
      `),
    ).toEqual([
      { pid: 10, ppid: 1, args: "node /usr/local/bin/claude --foo" },
      { pid: 13, ppid: 10, args: "npm run dev -- --host 127.0.0.1" },
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

  it("sums each process once when ps rows contain a parent cycle", () => {
    const selfParentRows = [
      { pid: 10, ppid: 10, rssKb: 100 },
      { pid: 11, ppid: 10, rssKb: 25 },
      { pid: 99, ppid: 1, rssKb: 1000 },
    ];
    const descendantCycleRows = [
      { pid: 20, ppid: 22, rssKb: 200 },
      { pid: 21, ppid: 20, rssKb: 30 },
      { pid: 22, ppid: 21, rssKb: 40 },
      { pid: 98, ppid: 1, rssKb: 1000 },
    ];

    expect(sumProcessTreeRss(selfParentRows, 10)).toBe(125);
    expect(sumProcessTreeRss(descendantCycleRows, 20)).toBe(270);
  });

  it("returns each process once when command rows contain a parent cycle", () => {
    const rows = [
      { pid: 20, ppid: 22, args: "root" },
      { pid: 21, ppid: 20, args: "child" },
      { pid: 22, ppid: 21, args: "grandchild" },
      { pid: 98, ppid: 1, args: "other" },
    ];

    expect(
      processTreeRows(rows, 20)
        .map((row) => row.pid)
        .sort(),
    ).toEqual([20, 21, 22]);
  });
});
