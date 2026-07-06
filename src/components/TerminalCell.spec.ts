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
    props: ["sessionId", "connectKey", "cwd"],
    emits: ["session", "cwd"],
    template: '<div class="stub-term" />',
    methods: {
      terminate() {},
      submitText() {
        return true;
      },
    },
  },
}));

const promptText = (w: ReturnType<typeof mount>) => w.find(".cell-prompt").text();
const dotClass = (w: ReturnType<typeof mount>) => w.find(".cell-dot").classes();

// Route by URL: /api/scripts (run list), /api/sessions (resume list), or
// /api/session/:id (activity).
function mockFetch(sessions: { id: string; title: string; mtime: number }[] = [], scripts: { index: number; label: string; command: string }[] = []) {
  globalThis.fetch = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("/api/scripts")) return { ok: true, json: async () => ({ cwd: "/home/me/proj", scripts }) };
    if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ sessions }) };
    return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) };
  }) as unknown as typeof fetch;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  captured = null;
  mockFetch();
});

function mountCell(
  initialSessionId: string | null,
  opts: {
    initialCwd?: string | null;
    defaultCwd?: string | null;
    presets?: { label: string; path: string }[];
    home?: string | null;
    cancellable?: boolean;
    openSessionIds?: string[];
  } = {},
) {
  return mount(TerminalCell, {
    props: {
      uid: 1,
      expanded: false,
      initialSessionId,
      initialCwd: opts.initialCwd ?? null,
      defaultCwd: opts.defaultCwd ?? "/home/me/my-project",
      presets: opts.presets ?? [],
      home: opts.home ?? "/home/me",
      cancellable: opts.cancellable ?? false,
      openSessionIds: opts.openSessionIds ?? [],
    },
  });
}

describe("TerminalCell", () => {
  it("shows the ~-anchored workspace path in the header", async () => {
    const w = mountCell("11111111-1111-1111-1111-111111111111", { initialCwd: "/home/me/ss/my-project" });
    await flushPromises();
    expect(w.find(".cell-dir").text()).toBe("~/ss/my-project");
  });

  it("clicking the header dir asks the server to open that folder", async () => {
    const urls: string[] = [];
    const bodies: string[] = [];
    globalThis.fetch = vi.fn((url: string, init?: { body?: string }) => {
      urls.push(String(url));
      if (init?.body) bodies.push(init.body);
      if (String(url).includes("/api/sessions")) return Promise.resolve({ ok: true, json: async () => ({ sessions: [] }) });
      return Promise.resolve({ ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) });
    }) as unknown as typeof fetch;

    const w = mountCell("11111111-1111-1111-1111-111111111111", { initialCwd: "/home/me/ss/proj" });
    await flushPromises();
    await w.find(".cell-dir").trigger("click");

    expect(urls).toContain("/api/open-dir");
    expect(bodies.some((b) => b.includes("/home/me/ss/proj"))).toBe(true);
  });

  it("shows a non-home path in full", async () => {
    const w = mountCell("55555555-5555-5555-5555-555555555555", { initialCwd: "/var/data/proj" });
    await flushPromises();
    expect(w.find(".cell-dir").text()).toBe("/var/data/proj");
  });

  it("launches in the dir typed in the form and sends it to the terminal", async () => {
    const w = mountCell(null, { defaultCwd: "/home/me/default" });
    await flushPromises();
    expect(w.find(".cell-launch").exists()).toBe(true);
    await w.find(".cell-dir-input").setValue("/home/me/picked");
    await w.find(".cell-dir-input").trigger("keydown.enter");
    const term = w.findComponent({ name: "TerminalView" });
    expect(term.exists()).toBe(true);
    expect(term.props("cwd")).toBe("/home/me/picked");
  });

  it("launches via the go button next to the field (alternative to Enter)", async () => {
    const w = mountCell(null, { defaultCwd: "/home/me/default" });
    await flushPromises();
    await w.find(".cell-dir-input").setValue("/home/me/picked");
    await w.find(".cell-dir-go").trigger("click");
    const term = w.findComponent({ name: "TerminalView" });
    expect(term.exists()).toBe(true);
    expect(term.props("cwd")).toBe("/home/me/picked");
  });

  it("disables the go button when the field is empty", async () => {
    const w = mountCell(null, { defaultCwd: null });
    await flushPromises();
    await w.find(".cell-dir-input").setValue("   ");
    expect((w.find(".cell-dir-go").element as HTMLButtonElement).disabled).toBe(true);
    await w.find(".cell-dir-input").setValue("/home/me/picked");
    expect((w.find(".cell-dir-go").element as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows a cancel ✕ on a cancellable launcher that emits close, but not otherwise", async () => {
    const plain = mountCell(null, { defaultCwd: "/home/me/default" });
    await flushPromises();
    expect(plain.find(".cell-launch-cancel").exists()).toBe(false);

    const w = mountCell(null, { defaultCwd: "/home/me/default", cancellable: true });
    await flushPromises();
    await w.find(".cell-launch-cancel").trigger("click");
    expect(w.emitted("close")).toHaveLength(1);
  });

  it("lists existing sessions for the dir and resumes one on click", async () => {
    mockFetch([{ id: "77777777-7777-7777-7777-777777777777", title: "fix the parser", mtime: Date.now() }]);
    const w = mountCell(null, { defaultCwd: "/home/me/proj" });
    await flushPromises();
    const item = w.find(".cell-resume-item");
    expect(item.exists()).toBe(true);
    expect(item.find(".ri-title").text()).toBe("fix the parser");
    await item.trigger("click");
    const term = w.findComponent({ name: "TerminalView" });
    expect(term.exists()).toBe(true);
    expect(term.props("sessionId")).toBe("77777777-7777-7777-7777-777777777777");
    expect(term.props("cwd")).toBe("/home/me/proj");
  });

  it("flags a resumable row that's already open in another terminal", async () => {
    const openId = "88888888-8888-8888-8888-888888888888";
    mockFetch([
      { id: openId, title: "running over there", mtime: Date.now() },
      { id: "99999999-9999-9999-9999-999999999999", title: "idle elsewhere", mtime: Date.now() },
    ]);
    const w = mountCell(null, { defaultCwd: "/home/me/proj", openSessionIds: [openId] });
    await flushPromises();
    const items = w.findAll(".cell-resume-item");
    expect(items[0].classes()).toContain("is-open");
    expect(items[0].find(".ri-open").exists()).toBe(true);
    expect(items[1].classes()).not.toContain("is-open");
    expect(items[1].find(".ri-open").exists()).toBe(false);
  });

  it("confirms before resuming a session open elsewhere, and bails on cancel", async () => {
    const openId = "88888888-8888-8888-8888-888888888888";
    mockFetch([{ id: openId, title: "running over there", mtime: Date.now() }]);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const w = mountCell(null, { defaultCwd: "/home/me/proj", openSessionIds: [openId] });
    await flushPromises();
    await w.find(".cell-resume-item").trigger("click");
    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(w.findComponent({ name: "TerminalView" }).exists()).toBe(false);
    confirmSpy.mockRestore();
  });

  it("resumes a session open elsewhere once the confirm is accepted", async () => {
    const openId = "88888888-8888-8888-8888-888888888888";
    mockFetch([{ id: openId, title: "running over there", mtime: Date.now() }]);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const w = mountCell(null, { defaultCwd: "/home/me/proj", openSessionIds: [openId] });
    await flushPromises();
    await w.find(".cell-resume-item").trigger("click");
    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(w.findComponent({ name: "TerminalView" }).props("sessionId")).toBe(openId);
    confirmSpy.mockRestore();
  });

  it("resumes a not-open-elsewhere session without any confirm", async () => {
    const id = "77777777-7777-7777-7777-777777777777";
    mockFetch([{ id, title: "fix the parser", mtime: Date.now() }]);
    const confirmSpy = vi.spyOn(window, "confirm");
    const w = mountCell(null, { defaultCwd: "/home/me/proj", openSessionIds: ["other-id"] });
    await flushPromises();
    await w.find(".cell-resume-item").trigger("click");
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(w.findComponent({ name: "TerminalView" }).props("sessionId")).toBe(id);
    confirmSpy.mockRestore();
  });

  it("lists script.json scripts for the dir and emits run with the resolved cwd", async () => {
    mockFetch(
      [],
      [
        { index: 0, label: "Build", command: "yarn build" },
        { index: 1, label: "Test", command: "yarn test" },
      ],
    );
    const w = mountCell(null, { defaultCwd: "/home/me/proj" });
    await flushPromises();
    const items = w.findAll(".cell-script-item");
    expect(items).toHaveLength(2);
    expect(items[0].text()).toContain("Build");
    await items[0].trigger("click");
    expect(w.emitted("run")?.[0]?.[0]).toEqual({ index: 0, label: "Build", cwd: "/home/me/proj" });
  });

  it("shows the resumed session's latest prompt from /api/session (with cwd), not the bare id", async () => {
    const urls: string[] = [];
    globalThis.fetch = vi.fn((url: string) => {
      urls.push(String(url));
      if (String(url).includes("/api/sessions")) return Promise.resolve({ ok: true, json: async () => ({ sessions: [] }) });
      return Promise.resolve({ ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: "refactor the parser" }) });
    }) as unknown as typeof fetch;

    const id = "11111111-1111-1111-1111-111111111111";
    const w = mountCell(id, { initialCwd: "/home/me/proj" });
    await flushPromises();

    expect(w.find(".cell-prompt").text()).toBe("refactor the parser");
    expect(urls.some((u) => u.includes(`/api/session/${id}`) && u.includes("cwd=%2Fhome%2Fme%2Fproj"))).toBe(true);
  });

  it("shows no resume list when the dir has no sessions", async () => {
    const w = mountCell(null);
    await flushPromises();
    expect(w.find(".cell-resume").exists()).toBe(false);
  });

  it("ignores an out-of-order session-list response (keeps the latest dir's rows)", async () => {
    const first = deferred<unknown>(); // mount fetch (dir A) — resolves LAST
    const second = deferred<unknown>(); // preset fetch (dir B) — resolves first
    let n = 0;
    globalThis.fetch = vi.fn((url: string) => {
      if (String(url).includes("/api/sessions")) return n++ === 0 ? first.promise : second.promise;
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }) as unknown as typeof fetch;

    const w = mountCell(null, { defaultCwd: "/A", presets: [{ label: "B", path: "/B" }] });
    await nextTick(); // mount → fetch #1 (dir A) in flight
    const chipB = w.findAll(".cell-chip").find((c) => c.find(".cell-chip-main").text() === "B");
    if (!chipB) throw new Error("preset B not found");
    await chipB.find(".cell-chip-fill").trigger("click"); // fillDir → fetch #2 (dir B)

    second.resolve({ ok: true, json: async () => ({ cwd: "/B", sessions: [{ id: "b-id", title: "B-sess", mtime: 1 }] }) });
    await flushPromises();
    first.resolve({ ok: true, json: async () => ({ cwd: "/A", sessions: [{ id: "a-id", title: "A-sess", mtime: 1 }] }) });
    await flushPromises();

    expect(w.findAll(".ri-title").map((x) => x.text())).toEqual(["B-sess"]);
  });

  it("resumes with the resolved cwd from the API, not the typed input", async () => {
    globalThis.fetch = vi.fn((url: string) => {
      if (String(url).includes("/api/sessions"))
        return Promise.resolve({ ok: true, json: async () => ({ cwd: "/resolved", sessions: [{ id: "id1", title: "t", mtime: Date.now() }] }) });
      return Promise.resolve({ ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) });
    }) as unknown as typeof fetch;

    const w = mountCell(null, { defaultCwd: "/typed" });
    await flushPromises();
    await w.find(".cell-resume-item").trigger("click");
    expect(w.findComponent({ name: "TerminalView" }).props("cwd")).toBe("/resolved");
  });

  it("clicking a preset chip launches a fresh session in its dir", async () => {
    const w = mountCell(null, { presets: [{ label: "proj", path: "/work/proj" }] });
    await flushPromises();
    const main = w.findAll(".cell-chip-main").find((b) => b.text() === "proj");
    if (!main) throw new Error("preset chip not found");
    await main.trigger("click");
    const term = w.findComponent({ name: "TerminalView" });
    expect(term.exists()).toBe(true);
    expect(term.props("cwd")).toBe("/work/proj");
  });

  it("a chip's fill button sets the dir WITHOUT launching (so the user can resume)", async () => {
    const w = mountCell(null, { presets: [{ label: "proj", path: "/work/proj" }] });
    await flushPromises();
    const chip = w.findAll(".cell-chip").find((c) => c.find(".cell-chip-main").text() === "proj");
    if (!chip) throw new Error("preset chip not found");
    await chip.find(".cell-chip-fill").trigger("click");
    // No terminal — the fill button only selects the directory.
    expect(w.findComponent({ name: "TerminalView" }).exists()).toBe(false);
    expect((w.find(".cell-dir-input").element as HTMLInputElement).value).toBe("/work/proj");
  });

  it("emits record-cwd with the server-confirmed cwd of a fresh launch", async () => {
    // A fresh launch + the server confirming the effective cwd asks the parent to
    // auto-record that dir as a preset (the parent persists it to config).
    const w = mountCell(null, { defaultCwd: "/home/me/default" });
    await flushPromises();
    await w.find(".cell-dir-input").setValue("/home/me/alpha");
    await w.find(".cell-dir-input").trigger("keydown.enter");
    w.findComponent({ name: "TerminalView" }).vm.$emit("cwd", "/home/me/alpha");
    await flushPromises();
    expect(w.emitted("record-cwd")?.at(-1)).toEqual(["/home/me/alpha"]);
  });

  it("emits remove-preset (and does NOT launch) when a chip's ✕ is clicked", async () => {
    const w = mountCell(null, { presets: [{ label: "proj", path: "/work/proj" }] });
    await flushPromises();
    const chip = w.findAll(".cell-chip").find((c) => c.find(".cell-chip-main").text() === "proj");
    if (!chip) throw new Error("preset chip not found");
    await chip.find(".cell-chip-del").trigger("click");
    expect(w.emitted("remove-preset")?.at(-1)).toEqual(["/work/proj"]);
    expect(w.findComponent({ name: "TerminalView" }).exists()).toBe(false);
  });

  it("does NOT emit record-cwd when a restored session reports its cwd (only fresh launches)", async () => {
    // A cell restoring a persisted session also gets a server cwd report on connect;
    // that must not record a preset (else reload would re-add dirs by mount order).
    const w = mountCell("11111111-1111-1111-1111-111111111111", { initialCwd: "/home/me/restored" });
    await flushPromises();
    w.findComponent({ name: "TerminalView" }).vm.$emit("cwd", "/home/me/restored");
    await flushPromises();
    expect(w.emitted("record-cwd")).toBeUndefined();
  });

  it("does NOT emit record-cwd when resuming an existing session from the resume list", async () => {
    mockFetch([{ id: "77777777-7777-7777-7777-777777777777", title: "fix the parser", mtime: Date.now() }]);
    const w = mountCell(null, { defaultCwd: "/home/me/proj" });
    await flushPromises();
    await w.find(".cell-resume-item").trigger("click");
    w.findComponent({ name: "TerminalView" }).vm.$emit("cwd", "/home/me/proj");
    await flushPromises();
    expect(w.emitted("record-cwd")).toBeUndefined();
  });

  it("clears the pending-record flag when a fresh launch is torn down before its cwd arrives", async () => {
    // Race: launch sets the record-next flag, but the user closes before the server
    // reports a cwd; a subsequent resume must NOT inherit that pending record.
    mockFetch([{ id: "77777777-7777-7777-7777-777777777777", title: "t", mtime: Date.now() }]);
    const w = mountCell(null, { defaultCwd: "/home/me/proj" });
    await flushPromises();
    await w.find(".cell-dir-input").setValue("/home/me/fresh");
    await w.find(".cell-dir-input").trigger("keydown.enter"); // flag = true, no cwd yet
    await w.find(".cell-close").trigger("click"); // teardown must clear the flag
    await flushPromises();
    await w.find(".cell-resume-item").trigger("click"); // resume an existing session
    w.findComponent({ name: "TerminalView" }).vm.$emit("cwd", "/home/me/proj");
    await flushPromises();
    expect(w.emitted("record-cwd")).toBeUndefined();
  });

  it("prefills the launch field with the most recent preset (not the server default)", async () => {
    const w = mountCell(null, { presets: [{ label: "last", path: "/home/me/last-used" }], defaultCwd: "/home/me/default" });
    await flushPromises();
    expect((w.find(".cell-dir-input").element as HTMLInputElement).value).toBe("/home/me/last-used");
  });

  it("syncs a late-arriving preset into the pristine launch field (open-before-config-load)", async () => {
    // Cold load: the cell mounts before /api/config resolves, so presets start empty
    // and the field falls back to the server default.
    const w = mountCell(null, { presets: [], defaultCwd: "/home/me/default" });
    await flushPromises();
    expect((w.find(".cell-dir-input").element as HTMLInputElement).value).toBe("/home/me/default");
    // /api/config resolves, delivering the most-recent preset — the pristine field upgrades.
    await w.setProps({ presets: [{ label: "alpha", path: "/home/me/alpha" }] });
    expect((w.find(".cell-dir-input").element as HTMLInputElement).value).toBe("/home/me/alpha");
  });

  it("does NOT override a user-edited launch field when presets arrive late", async () => {
    const w = mountCell(null, { presets: [], defaultCwd: "/home/me/default" });
    await flushPromises();
    await w.find(".cell-dir-input").setValue("/home/me/typed");
    await w.setProps({ presets: [{ label: "alpha", path: "/home/me/alpha" }] });
    expect((w.find(".cell-dir-input").element as HTMLInputElement).value).toBe("/home/me/typed");
  });

  it("resets the launch form to the default dir after close", async () => {
    const w = mountCell(null, { defaultCwd: "/home/me/default" });
    await flushPromises();
    await w.find(".cell-dir-input").setValue("/home/me/picked");
    await w.find(".cell-dir-input").trigger("keydown.enter");
    await w.find(".cell-close").trigger("click");
    await nextTick();
    expect(w.find(".cell-launch").exists()).toBe(true);
    expect((w.find(".cell-dir-input").element as HTMLInputElement).value).toBe("/home/me/default");
  });

  it("adopts the EFFECTIVE cwd the server reports (persists/shows that, not the typed one)", async () => {
    const w = mountCell(null, { defaultCwd: "/home/me/default" });
    await flushPromises();
    await w.find(".cell-dir-input").setValue("relative/bad/path");
    await w.find(".cell-dir-input").trigger("keydown.enter");
    // Server rejected the bad path and fell back; it reports the real cwd.
    w.findComponent({ name: "TerminalView" }).vm.$emit("cwd", "/home/me/default");
    await nextTick();
    // The cell persists + displays the effective cwd, not the typed one.
    expect(w.emitted("cwd")?.at(-1)).toEqual(["/home/me/default"]);
    expect(w.find(".cell-dir").text()).toBe("~/default");
  });

  it("reflects working / blocked / done pushed for its own session", async () => {
    const id = "22222222-2222-2222-2222-222222222222";
    const w = mountCell(id);
    await flushPromises();
    captured?.({ id, working: true, waiting: false, lastPrompt: "refactor the parser" });
    await nextTick();
    expect(promptText(w)).toBe("refactor the parser");
    expect(dotClass(w)).toContain("is-working");

    // waiting + Notification => blocked (needs input); + Stop => done (unreviewed).
    captured?.({ id, working: false, waiting: true, event: "Notification", lastPrompt: "refactor the parser" });
    await nextTick();
    expect(dotClass(w)).toContain("is-blocked");

    captured?.({ id, working: false, waiting: true, event: "Stop", lastPrompt: "refactor the parser" });
    await nextTick();
    expect(dotClass(w)).toContain("is-done");
  });

  it("shows a token-usage badge from /api/session/:id", async () => {
    const id = "55555555-5555-5555-5555-555555555555";
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/api/scripts")) return { ok: true, json: async () => ({ cwd: "/p", scripts: [] }) };
      if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ sessions: [] }) };
      return {
        ok: true,
        json: async () => ({
          working: false,
          waiting: false,
          lastPrompt: null,
          usage: { inputTokens: 1200, outputTokens: 3400, cacheReadTokens: 800, cacheCreationTokens: 0 },
        }),
      };
    }) as unknown as typeof fetch;
    const w = mountCell(id);
    await flushPromises();
    const badge = w.find(".cell-usage");
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toContain("2.0k"); // input 1200 + cacheRead 800 = 2000
    expect(badge.text()).toContain("3.4k"); // output 3400
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

  // The header's "open on GitHub" control: shown only when /api/git-remote
  // reports a repository URL for the cell's dir.
  function mockFetchWithGithub(githubUrl: string | null, ok = true) {
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/api/git-remote")) return { ok, json: async () => ({ githubUrl }) };
      if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ sessions: [] }) };
      return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) };
    }) as unknown as typeof fetch;
  }

  it("shows the GitHub button when the dir is a GitHub repo", async () => {
    mockFetchWithGithub("https://github.com/owner/repo");
    const w = mountCell("33333333-3333-3333-3333-333333333333", { initialCwd: "/home/me/repo" });
    await flushPromises();
    expect(w.find(".cell-gh").exists()).toBe(true);
  });

  it("hides the GitHub button for a non-GitHub repo (null) and on lookup failure", async () => {
    mockFetchWithGithub(null);
    const a = mountCell("33333333-3333-3333-3333-333333333333", { initialCwd: "/home/me/repo" });
    await flushPromises();
    expect(a.find(".cell-gh").exists()).toBe(false);

    mockFetchWithGithub("https://github.com/owner/repo", false); // res.ok = false
    const b = mountCell("33333333-3333-3333-3333-333333333333", { initialCwd: "/home/me/repo" });
    await flushPromises();
    expect(b.find(".cell-gh").exists()).toBe(false);
  });

  it("opens repository / issues / pull requests from the popover", async () => {
    mockFetchWithGithub("https://github.com/owner/repo");
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    const w = mountCell("33333333-3333-3333-3333-333333333333", { initialCwd: "/home/me/repo" });
    await flushPromises();

    const openItem = async (label: string) => {
      await w.find(".cell-gh").trigger("click");
      const item = w.findAll(".cell-gh-item").find((b) => b.text() === label);
      await item?.trigger("click");
    };
    await openItem("Repository");
    await openItem("Issues");
    await openItem("Pull requests");

    expect(openSpy.mock.calls.map((c) => c[0])).toEqual([
      "https://github.com/owner/repo",
      "https://github.com/owner/repo/issues",
      "https://github.com/owner/repo/pulls",
    ]);
    openSpy.mockRestore();
  });

  it("toggles the popover and closes it on Escape", async () => {
    mockFetchWithGithub("https://github.com/owner/repo");
    const w = mountCell("33333333-3333-3333-3333-333333333333", { initialCwd: "/home/me/repo" });
    await flushPromises();
    expect(w.find(".cell-gh-menu").exists()).toBe(false);
    await w.find(".cell-gh").trigger("click");
    expect(w.find(".cell-gh-menu").exists()).toBe(true);
    await w.find(".cell-gh-menu").trigger("keydown", { key: "Escape" });
    expect(w.find(".cell-gh-menu").exists()).toBe(false);
  });

  it("ignores an out-of-order /api/git-remote response after a fast cwd change", async () => {
    // dir A's lookup is in flight when the effective cwd switches to dir B; A
    // then resolves LAST. The request-token guard must keep B's repo, not A's.
    const repoA = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
    const repoB = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
    globalThis.fetch = vi.fn((url: string, init?: { body?: string }) => {
      const u = String(url);
      if (u.includes("/api/git-remote")) return String(init?.body ?? "").includes("/home/me/repoA") ? repoA.promise : repoB.promise;
      if (u.includes("/api/sessions")) return Promise.resolve({ ok: true, json: async () => ({ sessions: [] }) });
      return Promise.resolve({ ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) });
    }) as unknown as typeof fetch;

    const w = mountCell("33333333-3333-3333-3333-333333333333", { initialCwd: "/home/me/repoA" });
    w.findComponent({ name: "TerminalView" }).vm.$emit("cwd", "/home/me/repoB"); // server confirms a different dir
    await nextTick();

    repoB.resolve({ ok: true, json: async () => ({ githubUrl: "https://github.com/owner/repoB" }) }); // newer resolves first
    await flushPromises();
    repoA.resolve({ ok: true, json: async () => ({ githubUrl: "https://github.com/owner/repoA" }) }); // older resolves last
    await flushPromises();

    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    await w.find(".cell-gh").trigger("click");
    await w
      .findAll(".cell-gh-item")
      .find((b) => b.text() === "Repository")
      ?.trigger("click");
    expect(openSpy.mock.calls.at(-1)?.[0]).toBe("https://github.com/owner/repoB");
    openSpy.mockRestore();
  });
});
