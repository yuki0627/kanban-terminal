import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import CommandCell from "./CommandCell.vue";

// Stub the terminal so no xterm/WebSocket is needed; it just forwards the props the
// cell passes (command/connectKey) and can emit "exit" to drive the re-run UI.
vi.mock("./Terminal.vue", () => ({
  default: {
    name: "TerminalView",
    props: ["sessionId", "connectKey", "command"],
    emits: ["exit"],
    template: '<div class="stub-term" />',
  },
}));

const mountCell = () => mount(CommandCell, { props: { expanded: false, command: { index: 2, label: "Dev server" } } });
const term = (w: ReturnType<typeof mount>) => w.findComponent({ name: "TerminalView" });

describe("CommandCell", () => {
  it("shows the label and runs the command in command mode", () => {
    const w = mountCell();
    expect(w.find(".cell-cmd").text()).toContain("Dev server");
    expect(term(w).props("command")).toEqual({ index: 2, label: "Dev server" });
    expect(term(w).props("sessionId")).toBe(null); // not a Claude session
  });

  it("offers a re-run only after the command exits, and re-running reconnects", async () => {
    const w = mountCell();
    expect(w.find('[aria-label="Re-run command"]').exists()).toBe(false);

    term(w).vm.$emit("exit");
    await nextTick();
    const rerun = w.find('[aria-label="Re-run command"]');
    expect(rerun.exists()).toBe(true);

    const before = term(w).props("connectKey");
    await rerun.trigger("click");
    expect(term(w).props("connectKey")).toBe(before + 1); // forces a fresh connect
    expect(w.find('[aria-label="Re-run command"]').exists()).toBe(false); // running again
  });

  it("emits toggle-expand and close from the header buttons", async () => {
    const w = mountCell();
    await w.find('[aria-label="Expand terminal"]').trigger("click");
    await w.find('[aria-label="Close terminal"]').trigger("click");
    expect(w.emitted("toggle-expand")).toHaveLength(1);
    expect(w.emitted("close")).toHaveLength(1);
  });
});
