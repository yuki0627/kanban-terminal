import { describe, it, expect, vi, beforeEach } from "vitest";
import { useNotifications } from "./useNotifications";

vi.mock("./usePubSub", () => ({
  usePubSub: () => ({
    subscribe: vi.fn(),
    onReconnect: vi.fn(),
  }),
}));

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ active: [] }) })) as unknown as typeof fetch;
});

describe("useNotifications", () => {
  it("keeps notification activation non-navigating", () => {
    const { activate } = useNotifications();

    expect(activate()).toBe(false);
  });
});
