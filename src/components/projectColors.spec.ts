import { describe, expect, it } from "vitest";

import { AUTO_ASSIGN_COLORS, PROJECT_COLORS, autoProjectColor } from "./projectColors";

describe("PROJECT_COLORS", () => {
  it("Googleカレンダー相当の24色を持つ", () => {
    expect(PROJECT_COLORS).toHaveLength(24);
  });

  it("全て小文字HEX形式で重複がない", () => {
    for (const color of PROJECT_COLORS) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(new Set(PROJECT_COLORS).size).toBe(PROJECT_COLORS.length);
  });
});

describe("AUTO_ASSIGN_COLORS", () => {
  it("パレットの部分集合で重複がない(新規プロジェクトがピッカーでハイライトされる)", () => {
    expect(AUTO_ASSIGN_COLORS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(AUTO_ASSIGN_COLORS).size).toBe(AUTO_ASSIGN_COLORS.length);
    for (const color of AUTO_ASSIGN_COLORS) {
      expect(PROJECT_COLORS).toContain(color);
    }
  });
});

describe("autoProjectColor", () => {
  it("インデックス順に自動割当色を巡回する", () => {
    expect(autoProjectColor(0)).toBe(AUTO_ASSIGN_COLORS[0]);
    expect(autoProjectColor(1)).toBe(AUTO_ASSIGN_COLORS[1]);
    expect(autoProjectColor(AUTO_ASSIGN_COLORS.length)).toBe(AUTO_ASSIGN_COLORS[0]);
  });
});
