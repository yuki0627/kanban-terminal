import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import RunMenu from "./RunMenu.vue";

type Script = { index: number; label: string; command: string };

// /api/scripts echoes back a resolved cwd (the server may fall back from a bad
// path); the picked command must carry THAT cwd, not the requested one.
function mockFetch(scripts: Script[], cwd = "/home/me/proj") {
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ cwd, scripts }) })) as unknown as typeof fetch;
}

const SCRIPTS: Script[] = [
  { index: 0, label: "Dev server", command: "yarn dev" },
  { index: 1, label: "Unit tests", command: "yarn test" },
];

const mountMenu = () => mount(RunMenu, { props: { cwd: "/proj" } });

describe("RunMenu", () => {
  beforeEach(() => mockFetch(SCRIPTS));

  it("is closed until the trigger is clicked", () => {
    const w = mountMenu();
    expect(w.find(".run-pop").exists()).toBe(false);
  });

  it("opens, fetches, and lists the directory's scripts", async () => {
    const w = mountMenu();
    await w.find(".run-trigger").trigger("click");
    await flushPromises();
    const items = w.findAll(".run-item");
    expect(items).toHaveLength(2);
    expect(items[0].text()).toContain("Dev server");
  });

  it("emits the picked script with the server-resolved cwd, then closes", async () => {
    const w = mountMenu();
    await w.find(".run-trigger").trigger("click");
    await flushPromises();
    await w.findAll(".run-item")[1].trigger("click");
    expect(w.emitted("run")?.[0]?.[0]).toEqual({ index: 1, label: "Unit tests", cwd: "/home/me/proj" });
    expect(w.find(".run-pop").exists()).toBe(false); // closed after picking
  });

  it("shows an empty hint when there are no scripts", async () => {
    mockFetch([]);
    const w = mountMenu();
    await w.find(".run-trigger").trigger("click");
    await flushPromises();
    expect(w.find(".run-empty").text()).toContain("No scripts");
    expect(w.findAll(".run-item")).toHaveLength(0);
  });
});
