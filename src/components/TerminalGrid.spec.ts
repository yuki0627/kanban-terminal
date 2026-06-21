import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import TerminalGrid from "./TerminalGrid.vue";

// Stub the cell so the grid's own state (persist/restore + zoom + auto-layout) can
// be tested without pulling in Terminal/xterm/pub-sub.
vi.mock("./TerminalCell.vue", () => ({
  default: {
    name: "TerminalCell",
    props: ["expanded", "initialSessionId", "initialCwd", "defaultCwd", "presets", "home"],
    emits: ["toggle-expand", "session", "cwd", "close"],
    template: '<div class="stub-cell" />',
  },
}));

// Stub the command cell too: the grid only needs its props/emits, not the PTY relay.
vi.mock("./CommandCell.vue", () => ({
  default: {
    name: "CommandCell",
    props: ["expanded", "command"],
    emits: ["toggle-expand", "close"],
    template: '<div class="stub-command-cell" />',
  },
}));

const STORE_KEY = "grid_state_v1";
const mountGrid = () => mount(TerminalGrid, { props: { defaultCwd: "/work/proj", presets: [], home: "/work" } });
const cellsOf = (w: ReturnType<typeof mount>) => w.findAllComponents({ name: "TerminalCell" });
const commandCellsOf = (w: ReturnType<typeof mount>) => w.findAllComponents({ name: "CommandCell" });
const saved = () => JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
const lastAddState = (w: ReturnType<typeof mount>) => w.emitted("add-state")?.at(-1)?.[0];

const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const D = "dddddddd-dddd-dddd-dddd-dddddddddddd";

beforeEach(() => {
  localStorage.clear();
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ cwd: "/work/proj" }) })) as unknown as typeof fetch;
});

describe("TerminalGrid auto-layout", () => {
  it("shows a single launch cell on an empty grid", async () => {
    const w = mountGrid();
    await flushPromises();
    expect(cellsOf(w)).toHaveLength(1);
  });

  it("shows exactly the running terminals, packed (interleaved state is compacted on load)", async () => {
    localStorage.setItem(STORE_KEY, JSON.stringify({ sessions: [A, null, C, null], cwds: ["/a", null, "/c", null], expanded: null }));
    const w = mountGrid();
    await flushPromises();
    const cells = cellsOf(w);
    expect(cells).toHaveLength(2); // 2 running, no empty filler, no add cell
    expect(cells[0].props("initialSessionId")).toBe(A);
    expect(cells[1].props("initialSessionId")).toBe(C);
    expect(cells[1].props("initialCwd")).toBe("/c");
  });

  it("addCell toggles one trailing launch cell and reports add-state", async () => {
    localStorage.setItem(STORE_KEY, JSON.stringify({ sessions: [A, null, null, null], cwds: [], expanded: null }));
    const w = mountGrid();
    await flushPromises();
    expect(cellsOf(w)).toHaveLength(1);

    w.vm.addCell();
    await nextTick();
    expect(cellsOf(w)).toHaveLength(2);
    expect(cellsOf(w)[1].props("initialSessionId")).toBe(null);
    expect(lastAddState(w)).toEqual({ canAdd: true, adding: true });

    w.vm.addCell(); // toggle off (cancel)
    await nextTick();
    expect(cellsOf(w)).toHaveLength(1);
    expect(lastAddState(w)).toEqual({ canAdd: true, adding: false });
  });

  it("launching the add cell promotes it to a running terminal and stops adding", async () => {
    localStorage.setItem(STORE_KEY, JSON.stringify({ sessions: [A, null, null, null], cwds: [], expanded: null }));
    const w = mountGrid();
    await flushPromises();
    w.vm.addCell();
    await nextTick();
    cellsOf(w)[1].vm.$emit("session", B);
    await nextTick();
    expect(cellsOf(w)).toHaveLength(2); // both running now, add cell consumed
    expect(saved().sessions.slice(0, 2)).toEqual([A, B]);
    expect(lastAddState(w)).toEqual({ canAdd: true, adding: false });
  });

  it("caps the grid at 9 running (no 10th cell)", async () => {
    const ids = Array.from({ length: 9 }, (_, i) => `${String(i).repeat(8)}-aaaa-aaaa-aaaa-aaaaaaaaaaaa`);
    localStorage.setItem(STORE_KEY, JSON.stringify({ sessions: ids, cwds: [], expanded: null }));
    const w = mountGrid();
    await flushPromises();
    expect(cellsOf(w)).toHaveLength(9);
    w.vm.addCell();
    await nextTick();
    expect(cellsOf(w)).toHaveLength(9);
  });

  it("forwards defaultCwd to cells", async () => {
    const w = mountGrid();
    await flushPromises();
    expect(cellsOf(w)[0].props("defaultCwd")).toBe("/work/proj");
  });

  it("persists a cell's chosen cwd", async () => {
    localStorage.setItem(STORE_KEY, JSON.stringify({ sessions: [A, null, null, null], cwds: ["/a", null, null, null], expanded: null }));
    const w = mountGrid();
    await flushPromises();
    cellsOf(w)[0].vm.$emit("cwd", "/work/proj/sub");
    await nextTick();
    expect(saved().cwds[0]).toBe("/work/proj/sub");
  });

  it("persists a session id when a cell emits 'session'", async () => {
    const w = mountGrid();
    await flushPromises();
    cellsOf(w)[0].vm.$emit("session", A);
    await nextTick();
    expect(saved().sessions[0]).toBe(A);
  });

  it("clears the slot, un-zooms, and shrinks on close", async () => {
    localStorage.setItem(STORE_KEY, JSON.stringify({ sessions: [A, B, C, D], cwds: ["/a", "/b", "/c", "/d"], expanded: 1 }));
    const w = mountGrid();
    await flushPromises();
    expect(cellsOf(w)).toHaveLength(4);
    cellsOf(w)[1].vm.$emit("close"); // close B (zoomed)
    await nextTick();
    expect(saved().sessions.slice(0, 4)).toEqual([A, C, D, null]); // gap filled
    expect(saved().cwds.slice(0, 4)).toEqual(["/a", "/c", "/d", null]);
    expect(saved().expanded).toBe(null);
    expect(cellsOf(w)).toHaveLength(3); // 3 running now
    expect(cellsOf(w)[1].props("initialSessionId")).toBe(C);
  });

  it("toggles zoom on 'toggle-expand' and back off again", async () => {
    localStorage.setItem(STORE_KEY, JSON.stringify({ sessions: [A, B, null, null], cwds: [], expanded: null }));
    const w = mountGrid();
    await flushPromises();
    cellsOf(w)[1].vm.$emit("toggle-expand");
    await nextTick();
    expect(cellsOf(w)[1].props("expanded")).toBe(true);
    expect(saved().expanded).toBe(1);
    cellsOf(w)[1].vm.$emit("toggle-expand");
    await nextTick();
    expect(saved().expanded).toBe(null);
  });

  it("restores running sessions and the zoom from localStorage", async () => {
    localStorage.setItem(STORE_KEY, JSON.stringify({ sessions: [A, C, null, null], expanded: 1 }));
    const w = mountGrid();
    await flushPromises();
    const cells = cellsOf(w);
    expect(cells).toHaveLength(2);
    expect(cells[0].props("initialSessionId")).toBe(A);
    expect(cells[1].props("initialSessionId")).toBe(C);
    expect(cells[1].props("expanded")).toBe(true);
  });

  it("drops a restored zoom that no longer lands on a running cell", async () => {
    // Only A is valid; the stored expanded position points past the running cell.
    localStorage.setItem(STORE_KEY, JSON.stringify({ sessions: [A, null, null, null], expanded: 2 }));
    const w = mountGrid();
    await flushPromises();
    expect(cellsOf(w).every((c) => c.props("expanded") === false)).toBe(true);
  });

  it("drops non-UUID persisted session ids", async () => {
    localStorage.setItem(STORE_KEY, JSON.stringify({ sessions: ["not-a-uuid", "../etc/passwd", A, null], expanded: null }));
    const w = mountGrid();
    await flushPromises();
    const cells = cellsOf(w);
    expect(cells).toHaveLength(1); // only A survives
    expect(cells[0].props("initialSessionId")).toBe(A);
  });

  it("ignores a corrupt localStorage payload", async () => {
    localStorage.setItem(STORE_KEY, "not json{");
    const w = mountGrid();
    await flushPromises();
    expect(cellsOf(w)).toHaveLength(1);
  });
});

describe("TerminalGrid run scripts", () => {
  it("runs a script in a fresh command cell and does not persist it (ephemeral)", async () => {
    const w = mountGrid();
    await flushPromises();
    w.vm.runScript(1, "Dev server");
    await nextTick();
    expect(commandCellsOf(w)).toHaveLength(1);
    expect(commandCellsOf(w)[0].props("command")).toEqual({ index: 1, label: "Dev server" });
    expect(saved().sessions[0]).toBe(null); // command isn't written to localStorage
  });

  it("grows the grid: a command cell sits beside a running session", async () => {
    localStorage.setItem(STORE_KEY, JSON.stringify({ sessions: [A, null, null, null], cwds: [], expanded: null }));
    const w = mountGrid();
    await flushPromises();
    expect(cellsOf(w)).toHaveLength(1);
    w.vm.runScript(0, "Build");
    await nextTick();
    expect(cellsOf(w)).toHaveLength(1); // the session cell
    expect(commandCellsOf(w)).toHaveLength(1); // + the command cell
  });

  it("closes a command cell and shrinks back to a single launch cell", async () => {
    const w = mountGrid();
    await flushPromises();
    w.vm.runScript(0, "Build");
    await nextTick();
    expect(commandCellsOf(w)).toHaveLength(1);
    commandCellsOf(w)[0].vm.$emit("close");
    await nextTick();
    expect(commandCellsOf(w)).toHaveLength(0);
    expect(cellsOf(w)).toHaveLength(1);
  });

  it("counts command cells toward the 9-cell cap", async () => {
    const ids = Array.from({ length: 9 }, (_, i) => `${String(i).repeat(8)}-aaaa-aaaa-aaaa-aaaaaaaaaaaa`);
    localStorage.setItem(STORE_KEY, JSON.stringify({ sessions: ids, cwds: [], expanded: null }));
    const w = mountGrid();
    await flushPromises();
    expect(cellsOf(w)).toHaveLength(9);
    w.vm.runScript(0, "Build"); // grid full — no-op
    await nextTick();
    expect(commandCellsOf(w)).toHaveLength(0);
  });
});
