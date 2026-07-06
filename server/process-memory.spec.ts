import { describe, it, expect } from "vitest";
import { parsePsRows, sumProcessTreeRss } from "./process-memory.js";

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
});
