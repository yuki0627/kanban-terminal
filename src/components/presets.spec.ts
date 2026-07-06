import { describe, it, expect } from "vitest";
import { presetLabel } from "./presets";

describe("presetLabel", () => {
  it("uses the trailing path segment (basename)", () => {
    expect(presetLabel("/home/me/my-project")).toBe("my-project");
    expect(presetLabel("/home/me/my-project/")).toBe("my-project"); // ignores a trailing slash
  });

  it("handles a Windows-style path", () => {
    expect(presetLabel("C:\\work\\proj")).toBe("proj");
  });
});
