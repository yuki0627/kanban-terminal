import { describe, it, expect, beforeEach } from "vitest";
import { Terminal } from "@xterm/xterm";
import { forceCursorBlink } from "./cursorBlinkOverride";

// Write a sequence and wait for xterm's async parse to complete.
function feed(term: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => term.write(data, resolve));
}

describe("forceCursorBlink", () => {
  // xterm runs custom CSI handlers in reverse registration order and stops at the
  // first one returning true. A sentinel registered BEFORE the override therefore
  // fires only when the override does NOT swallow the sequence — that's how these
  // tests observe swallow vs pass-through using public API alone.
  let term: Terminal;
  let decscusrPassed: (number | number[])[][];
  let decrstPassed: (number | number[])[][];

  beforeEach(() => {
    term = new Terminal({ cursorBlink: true, cursorStyle: "block" });
    decscusrPassed = [];
    decrstPassed = [];
    term.parser.registerCsiHandler({ intermediates: " ", final: "q" }, (p) => {
      decscusrPassed.push([...p]);
      return false;
    });
    term.parser.registerCsiHandler({ prefix: "?", final: "l" }, (p) => {
      decrstPassed.push([...p]);
      return false;
    });
    forceCursorBlink(term);
  });

  it("DECSCUSR steady block (2) — Claude Code's request: applies the shape, swallows the blink-off", async () => {
    await feed(term, "\x1b[2 q");
    expect(term.options.cursorStyle).toBe("block");
    expect(decscusrPassed).toEqual([]);
  });

  it("DECSCUSR steady underline (4): applies underline, swallows", async () => {
    await feed(term, "\x1b[4 q");
    expect(term.options.cursorStyle).toBe("underline");
    expect(decscusrPassed).toEqual([]);
  });

  it("DECSCUSR blinking bar (5): applies bar, swallows (blink already on)", async () => {
    await feed(term, "\x1b[5 q");
    expect(term.options.cursorStyle).toBe("bar");
    expect(decscusrPassed).toEqual([]);
  });

  it("DECSCUSR default (0 and omitted param): resets the shape to block, swallows", async () => {
    term.options.cursorStyle = "bar";
    await feed(term, "\x1b[0 q");
    expect(term.options.cursorStyle).toBe("block");
    term.options.cursorStyle = "bar";
    await feed(term, "\x1b[ q");
    expect(term.options.cursorStyle).toBe("block");
    expect(decscusrPassed).toEqual([]);
  });

  it("unknown DECSCUSR param: passes through to xterm untouched", async () => {
    await feed(term, "\x1b[9 q");
    expect(decscusrPassed).toEqual([[9]]);
  });

  it("DECRST 12 (cursor blink off): swallowed", async () => {
    await feed(term, "\x1b[?12l");
    expect(decrstPassed).toEqual([]);
  });

  it("other DECRST modes pass through (e.g. hide cursor ?25l)", async () => {
    await feed(term, "\x1b[?25l");
    expect(decrstPassed).toEqual([[25]]);
  });

  it("multi-param DECRST bundling 12 passes through (documented limitation)", async () => {
    await feed(term, "\x1b[?25;12l");
    expect(decrstPassed).toEqual([[25, 12]]);
  });
});
