import { describe, it, expect } from "vitest";
import { LAYOUTS, isLayout, dims, trackStyle } from "./gridLayout";

describe("gridLayout", () => {
  it("exposes the four layouts", () => {
    expect(LAYOUTS).toEqual(["2x2", "3x2", "4x2", "3x3"]);
  });

  it("isLayout accepts known layouts and rejects everything else", () => {
    expect(isLayout("2x2")).toBe(true);
    expect(isLayout("3x3")).toBe(true);
    expect(isLayout("5x5")).toBe(false);
    expect(isLayout(null)).toBe(false);
    expect(isLayout(42)).toBe(false);
  });

  it("dims returns cols/rows/cellCount", () => {
    expect(dims("2x2")).toEqual({ cols: 2, rows: 2, cellCount: 4 });
    expect(dims("3x2")).toEqual({ cols: 3, rows: 2, cellCount: 6 });
    expect(dims("4x2")).toEqual({ cols: 4, rows: 2, cellCount: 8 });
    expect(dims("3x3")).toEqual({ cols: 3, rows: 3, cellCount: 9 });
  });

  it("trackStyle: full even tracks when nothing is zoomed", () => {
    expect(trackStyle("3x2", null)).toEqual({
      gridTemplateColumns: "1fr 1fr 1fr",
      gridTemplateRows: "1fr 1fr",
      gap: "6px",
    });
  });

  it("trackStyle: collapses other tracks around the zoomed cell", () => {
    // 3x3, expand index 4 (center): col 1, row 1.
    expect(trackStyle("3x3", 4)).toEqual({
      gridTemplateColumns: "0fr 1fr 0fr",
      gridTemplateRows: "0fr 1fr 0fr",
      gap: "0px",
    });
    // index 0 (top-left): col 0, row 0.
    expect(trackStyle("3x3", 0)).toEqual({
      gridTemplateColumns: "1fr 0fr 0fr",
      gridTemplateRows: "1fr 0fr 0fr",
      gap: "0px",
    });
  });
});
