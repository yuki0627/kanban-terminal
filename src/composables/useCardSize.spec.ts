import { describe, it, expect, beforeEach, vi } from "vitest";

// cardSize is a module-level singleton (loaded once at import time, like
// useTheme's themeId), so each test needs a fresh module instance to control
// what loadCardSize() sees in localStorage at "startup".
async function freshModule() {
  vi.resetModules();
  return import("./useCardSize");
}

beforeEach(() => {
  localStorage.clear();
});

describe("useCardSize", () => {
  it("defaults to medium when localStorage is empty", async () => {
    const { useCardSize } = await freshModule();
    const { cardSize } = useCardSize();
    expect(cardSize.value).toBe("m");
  });

  it("restores a previously persisted size on load", async () => {
    localStorage.setItem("card_size", "l");
    const { useCardSize } = await freshModule();
    const { cardSize } = useCardSize();
    expect(cardSize.value).toBe("l");
  });

  it("falls back to medium when localStorage holds an invalid value", async () => {
    localStorage.setItem("card_size", "xl");
    const { useCardSize } = await freshModule();
    const { cardSize } = useCardSize();
    expect(cardSize.value).toBe("m");
  });

  it("setCardSize updates the ref and persists the choice", async () => {
    const { useCardSize } = await freshModule();
    const { cardSize, setCardSize } = useCardSize();
    setCardSize("s");
    expect(cardSize.value).toBe("s");
    expect(localStorage.getItem("card_size")).toBe("s");
  });

  it("isCardSizeId accepts only the three known ids", async () => {
    const { isCardSizeId } = await freshModule();
    expect(isCardSizeId("s")).toBe(true);
    expect(isCardSizeId("m")).toBe(true);
    expect(isCardSizeId("l")).toBe(true);
    expect(isCardSizeId("xl")).toBe(false);
    expect(isCardSizeId(null)).toBe(false);
    expect(isCardSizeId(undefined)).toBe(false);
    expect(isCardSizeId(123)).toBe(false);
  });
});
