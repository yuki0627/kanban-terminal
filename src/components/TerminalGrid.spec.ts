import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import TerminalGrid from "./TerminalGrid.vue";

// Stub the cell so the grid's own state (localStorage persist/restore + zoom)
// can be tested without pulling in Terminal/xterm/pub-sub.
vi.mock("./TerminalCell.vue", () => ({
  default: {
    name: "TerminalCell",
    props: ["expanded", "initialSessionId", "cwd"],
    emits: ["toggle-expand", "session", "close"],
    template: '<div class="stub-cell" />',
  },
}));

const STORE_KEY = "grid_state_v1";
const cellsOf = (w: ReturnType<typeof mount>) => w.findAllComponents({ name: "TerminalCell" });
const saved = () => JSON.parse(localStorage.getItem(STORE_KEY) || "{}");

beforeEach(() => {
  localStorage.clear();
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ cwd: "/tmp/proj" }) })) as unknown as typeof fetch;
});

describe("TerminalGrid", () => {
  it("renders a fixed 2x2 of empty cells by default", async () => {
    const w = mount(TerminalGrid);
    await flushPromises();
    const cells = cellsOf(w);
    expect(cells).toHaveLength(4);
    expect(cells.every((c) => c.props("initialSessionId") === null)).toBe(true);
    expect(cells.every((c) => c.props("expanded") === false)).toBe(true);
  });

  it("restores each cell's session id and the zoom from localStorage", async () => {
    localStorage.setItem(STORE_KEY, JSON.stringify({ sessions: ["id-a", null, "id-c", null], expanded: 2 }));
    const w = mount(TerminalGrid);
    await flushPromises();
    const cells = cellsOf(w);
    expect(cells[0].props("initialSessionId")).toBe("id-a");
    expect(cells[1].props("initialSessionId")).toBe(null);
    expect(cells[2].props("initialSessionId")).toBe("id-c");
    expect(cells[2].props("expanded")).toBe(true);
    expect(cells[0].props("expanded")).toBe(false);
  });

  it("passes the fetched cwd to cells", async () => {
    const w = mount(TerminalGrid);
    await flushPromises();
    expect(cellsOf(w)[0].props("cwd")).toBe("/tmp/proj");
  });

  it("persists a cell's session id when it emits 'session'", async () => {
    const w = mount(TerminalGrid);
    await flushPromises();
    cellsOf(w)[1].vm.$emit("session", "new-id");
    await nextTick();
    expect(saved().sessions[1]).toBe("new-id");
  });

  it("clears the slot (and un-zooms) when a cell emits 'close'", async () => {
    localStorage.setItem(STORE_KEY, JSON.stringify({ sessions: ["id-a", null, null, null], expanded: 0 }));
    const w = mount(TerminalGrid);
    await flushPromises();
    cellsOf(w)[0].vm.$emit("close");
    await nextTick();
    expect(saved().sessions[0]).toBe(null);
    expect(saved().expanded).toBe(null);
    expect(cellsOf(w)[0].props("expanded")).toBe(false);
  });

  it("toggles zoom on 'toggle-expand' and back off when emitted again", async () => {
    const w = mount(TerminalGrid);
    await flushPromises();
    cellsOf(w)[3].vm.$emit("toggle-expand");
    await nextTick();
    expect(cellsOf(w)[3].props("expanded")).toBe(true);
    expect(saved().expanded).toBe(3);
    cellsOf(w)[3].vm.$emit("toggle-expand");
    await nextTick();
    expect(cellsOf(w)[3].props("expanded")).toBe(false);
    expect(saved().expanded).toBe(null);
  });

  it("ignores a corrupt localStorage payload", async () => {
    localStorage.setItem(STORE_KEY, "not json{");
    const w = mount(TerminalGrid);
    await flushPromises();
    const cells = cellsOf(w);
    expect(cells).toHaveLength(4);
    expect(cells.every((c) => c.props("initialSessionId") === null)).toBe(true);
  });
});
