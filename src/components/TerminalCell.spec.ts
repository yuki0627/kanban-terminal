import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import TerminalCell from "./TerminalCell.vue";

// Capture the "sessions" pub/sub callback so tests can push activity directly.
let captured: ((data: unknown) => void) | null = null;
vi.mock("../composables/usePubSub", () => ({
  usePubSub: () => ({
    subscribe: (_channel: string, cb: (data: unknown) => void) => {
      captured = cb;
      return () => {};
    },
  }),
}));

// Stub the terminal so no xterm/WebSocket is needed; expose terminate() since
// the cell's close() calls it.
vi.mock("./Terminal.vue", () => ({
  default: {
    name: "TerminalView",
    props: ["sessionId", "connectKey"],
    emits: ["session"],
    template: '<div class="stub-term" />',
    methods: { terminate() {} },
  },
}));

const promptText = (w: ReturnType<typeof mount>) => w.find(".cell-prompt").text();
const dotClass = (w: ReturnType<typeof mount>) => w.find(".cell-dot").classes();

beforeEach(() => {
  captured = null;
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) })) as unknown as typeof fetch;
});

function mountCell(initialSessionId: string | null) {
  return mount(TerminalCell, { props: { expanded: false, initialSessionId, cwd: "/home/me/my-project" } });
}

describe("TerminalCell", () => {
  it("shows the workspace dir basename in the header", async () => {
    const w = mountCell("11111111-1111-1111-1111-111111111111");
    await flushPromises();
    expect(w.find(".cell-dir").text()).toBe("my-project");
  });

  it("derives the basename from a Windows-style path too", async () => {
    const w = mount(TerminalCell, { props: { expanded: false, initialSessionId: "55555555-5555-5555-5555-555555555555", cwd: "C:\\work\\proj" } });
    await flushPromises();
    expect(w.find(".cell-dir").text()).toBe("proj");
  });

  it("reflects working/waiting/lastPrompt pushed for its own session", async () => {
    const id = "22222222-2222-2222-2222-222222222222";
    const w = mountCell(id);
    await flushPromises();
    captured?.({ id, working: true, waiting: false, lastPrompt: "refactor the parser" });
    await nextTick();
    expect(promptText(w)).toBe("refactor the parser");
    expect(dotClass(w)).toContain("is-working");

    captured?.({ id, working: false, waiting: true, lastPrompt: "refactor the parser" });
    await nextTick();
    expect(dotClass(w)).toContain("is-waiting");
  });

  it("clears a stale prompt when the server sends lastPrompt: null", async () => {
    const id = "33333333-3333-3333-3333-333333333333";
    const w = mountCell(id);
    await flushPromises();
    captured?.({ id, working: false, waiting: false, lastPrompt: "old prompt" });
    await nextTick();
    expect(promptText(w)).toBe("old prompt");

    captured?.({ id, working: false, waiting: false, lastPrompt: null });
    await nextTick();
    // Falls back to the short session id, not the stale prompt.
    expect(promptText(w)).not.toBe("old prompt");
    expect(promptText(w)).toBe(id.slice(0, 8));
  });

  it("ignores activity for a different session", async () => {
    const id = "44444444-4444-4444-4444-444444444444";
    const w = mountCell(id);
    await flushPromises();
    captured?.({ id: "99999999-9999-9999-9999-999999999999", working: true, lastPrompt: "not mine" });
    await nextTick();
    expect(promptText(w)).not.toBe("not mine");
    expect(dotClass(w)).toContain("is-idle");
  });
});
