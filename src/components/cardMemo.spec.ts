import { describe, it, expect } from "vitest";
import { memoLineCount, memoClampLines, memoHasOverflow, clampMemoHeight, MEMO_MIN_HEIGHT } from "./cardMemo";

describe("memoLineCount", () => {
  it("returns 0 for an empty string", () => {
    expect(memoLineCount("")).toBe(0);
  });

  it("returns 0 for whitespace-only text", () => {
    expect(memoLineCount("   \n  \t ")).toBe(0);
  });

  it("returns 1 for a single line", () => {
    expect(memoLineCount("a single line")).toBe(1);
  });

  it("treats a trailing newline as still one line", () => {
    expect(memoLineCount("a\n")).toBe(1);
  });

  it("returns 2 for two lines", () => {
    expect(memoLineCount("a\nb")).toBe(2);
  });

  it("counts internal blank lines (a\\n\\nb is 3 lines)", () => {
    expect(memoLineCount("a\n\nb")).toBe(3);
  });

  it("counts CRLF line endings the same as LF", () => {
    expect(memoLineCount("a\r\nb\r\nc")).toBe(3);
    expect(memoLineCount("a\r\n")).toBe(1);
  });
});

describe("memoClampLines", () => {
  it("returns 0 (hidden) for size s", () => {
    expect(memoClampLines("s")).toBe(0);
  });

  it("returns 1 for size m", () => {
    expect(memoClampLines("m")).toBe(1);
  });

  it("returns 3 for size l", () => {
    expect(memoClampLines("l")).toBe(3);
  });
});

describe("memoHasOverflow", () => {
  it("is always false at size s regardless of line count", () => {
    expect(memoHasOverflow("a", "s")).toBe(false);
    expect(memoHasOverflow("a\nb\nc\nd", "s")).toBe(false);
  });

  it("at size m is false for 1 line", () => {
    expect(memoHasOverflow("a", "m")).toBe(false);
  });

  it("at size m is true for 2 lines", () => {
    expect(memoHasOverflow("a\nb", "m")).toBe(true);
  });

  it("at size l is false for 3 lines", () => {
    expect(memoHasOverflow("a\nb\nc", "l")).toBe(false);
  });

  it("at size l is true for 4 lines", () => {
    expect(memoHasOverflow("a\nb\nc\nd", "l")).toBe(true);
  });
});

describe("clampMemoHeight", () => {
  it("rounds and passes through a height within range", () => {
    expect(clampMemoHeight(120.4, 600)).toBe(120);
  });

  it("clamps below the minimum up to MEMO_MIN_HEIGHT", () => {
    expect(clampMemoHeight(10, 600)).toBe(MEMO_MIN_HEIGHT);
    expect(clampMemoHeight(-50, 600)).toBe(MEMO_MIN_HEIGHT);
  });

  it("caps at 60% of the body height so the terminal prompt stays visible", () => {
    expect(clampMemoHeight(500, 600)).toBe(360);
  });

  it("keeps the minimum even when 60% of the body is smaller than it", () => {
    expect(clampMemoHeight(500, 60)).toBe(MEMO_MIN_HEIGHT);
  });

  it("falls back to a 400px cap when the body height is unknown", () => {
    expect(clampMemoHeight(1000, null)).toBe(400);
    expect(clampMemoHeight(120, null)).toBe(120);
  });
});
