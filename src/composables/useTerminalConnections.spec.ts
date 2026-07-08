import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const terminalInstances = vi.hoisted(() => [] as Array<{ writes: string[]; keyHandlers: Array<(event: KeyboardEvent) => boolean> }>);

// Mock xterm + addons so the manager runs headless (no real DOM terminal / canvas).
// Factories are hoisted above imports, so the fakes are declared INSIDE them.
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    options: Record<string, unknown> = {};
    cols = 80;
    rows = 24;
    writes: string[] = [];
    keyHandlers: Array<(event: KeyboardEvent) => boolean> = [];
    constructor() {
      terminalInstances.push(this);
    }
    loadAddon() {}
    open() {}
    onData() {}
    attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) {
      this.keyHandlers.push(handler);
    }
    write(data: string, callback?: () => void) {
      this.writes.push(data);
      callback?.();
    }
    reset() {}
    focus() {}
    scrollToBottom() {}
    dispose() {}
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
  },
}));
vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class {
    activate() {}
  },
}));
vi.mock("@xterm/addon-clipboard", () => ({
  ClipboardAddon: class {
    activate() {}
  },
}));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

// A WebSocket double the test drives by hand (fire onopen / onmessage when it wants).
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static readonly instances: FakeWebSocket[] = [];
  url: string;
  readyState = FakeWebSocket.OPEN; // treat as open immediately for send() guards
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.readyState = FakeWebSocket.CLOSED;
  }
}

import * as conn from "./useTerminalConnections";

const target = (sessionId: string | null) => ({ sessionId, cwd: "/typed", devTerminal: false, command: null, launcher: null });

const terminalKeyEvent = (overrides: Partial<conn.TerminalKeyEventLike> = {}): conn.TerminalKeyEventLike => ({
  type: "keydown",
  key: "Enter",
  shiftKey: true,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  ...overrides,
});

const attachSlot = (key: string, handlers: conn.ConnHandlers = {}) => {
  const el = document.createElement("div");
  conn.attach(key, target(null), handlers, el);
  const ws = FakeWebSocket.instances.at(-1);
  if (!ws) throw new Error("no socket created");
  ws.onopen?.();
  return { el, ws, term: terminalInstances.at(-1) };
};

describe("useTerminalConnections — detached-slot state replay", () => {
  beforeEach(() => {
    FakeWebSocket.instances.length = 0;
    terminalInstances.length = 0;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  });
  afterEach(() => {
    conn.release("cell-race"); // tear the slot down so it can't leak into the next test
  });

  it("replays a session id learned WHILE DETACHED to the handlers bound on reattach", () => {
    const first = { onSession: vi.fn(), onCwd: vi.fn() };
    const el1 = document.createElement("div");
    conn.attach("cell-race", target(null), first, el1); // fresh launch, no id yet
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("no socket created");
    ws.onopen?.();

    // User navigates away BEFORE the server reports the session id.
    conn.detach("cell-race", el1);
    expect(conn.connView.get("cell-race")).toBeTruthy(); // socket/slot still alive

    // Server NOW assigns the id + resolves the cwd — handlers are detached, so the
    // first view's callbacks must NOT fire (it's gone).
    ws.onmessage?.({ data: JSON.stringify({ type: "session", id: "sess-123", cwd: "/resolved" }) });
    expect(first.onSession).not.toHaveBeenCalled();

    // Coming back must catch the parent up: the freshly-bound handlers receive the
    // id/cwd that arrived while detached — without this the cell stays session:null
    // and is unrestorable on reload.
    const second = { onSession: vi.fn(), onCwd: vi.fn() };
    const el2 = document.createElement("div");
    conn.attach("cell-race", target(null), second, el2);
    expect(second.onSession).toHaveBeenCalledWith("sess-123");
    expect(second.onCwd).toHaveBeenCalledWith("/resolved");
  });

  it("does not replay a session id before the server has assigned one", () => {
    const first = { onSession: vi.fn(), onCwd: vi.fn() };
    const el1 = document.createElement("div");
    conn.attach("cell-race", target(null), first, el1);
    FakeWebSocket.instances.at(-1)?.onopen?.();
    conn.detach("cell-race", el1);

    // No `session` message yet — reattaching must not synthesize a bogus id.
    const second = { onSession: vi.fn(), onCwd: vi.fn() };
    conn.attach("cell-race", target(null), second, document.createElement("div"));
    expect(second.onSession).not.toHaveBeenCalled();
    expect(second.onCwd).not.toHaveBeenCalled();
  });
});

describe("useTerminalConnections — handleMessage characterization", () => {
  const keys = ["cell-session", "cell-exit", "cell-superseded", "cell-error"];

  beforeEach(() => {
    FakeWebSocket.instances.length = 0;
    terminalInstances.length = 0;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    for (const key of keys) conn.release(key);
    vi.useRealTimers();
  });

  it("propagates session id and resolved cwd to handlers and connView", () => {
    const handlers = { onSession: vi.fn(), onCwd: vi.fn() };
    const { ws } = attachSlot("cell-session", handlers);

    ws.onmessage?.({ data: JSON.stringify({ type: "session", id: "sess-live", cwd: "/repo/resolved" }) });

    expect(handlers.onSession).toHaveBeenCalledTimes(1);
    expect(handlers.onSession).toHaveBeenCalledWith("sess-live");
    expect(handlers.onCwd).toHaveBeenCalledTimes(1);
    expect(handlers.onCwd).toHaveBeenCalledWith("/repo/resolved");
    expect(conn.connView.get("cell-session")).toEqual({ status: "connected", serverCwd: "/repo/resolved" });
  });

  it("marks exit as intentional, writes the ended banner, and calls onExit", () => {
    vi.useFakeTimers();
    const handlers = { onExit: vi.fn() };
    const { ws, term } = attachSlot("cell-exit", handlers);

    ws.onmessage?.({ data: JSON.stringify({ type: "exit" }) });
    ws.onclose?.();
    vi.advanceTimersByTime(5_000);

    expect(term?.writes).toEqual(["\r\n\x1b[33m[session ended]\x1b[0m\r\n"]);
    expect(conn.connView.get("cell-exit")).toEqual({ status: "disconnected", serverCwd: "/typed" });
    expect(handlers.onExit).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("does not reconnect after a superseded message", () => {
    vi.useFakeTimers();
    const handlers = { onExit: vi.fn() };
    const { ws, term } = attachSlot("cell-superseded", handlers);

    ws.onmessage?.({ data: JSON.stringify({ type: "superseded" }) });
    ws.onclose?.();
    vi.advanceTimersByTime(5_000);

    expect(term?.writes).toEqual(["\r\n\x1b[33m[detached — this session is open in another window]\x1b[0m\r\n"]);
    expect(conn.connView.get("cell-superseded")).toEqual({ status: "disconnected", serverCwd: "/typed" });
    expect(handlers.onExit).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("surfaces server errors in the terminal and calls onExit", () => {
    const handlers = { onExit: vi.fn() };
    const { ws, term } = attachSlot("cell-error", handlers);

    ws.onmessage?.({ data: JSON.stringify({ type: "error", message: "missing cli" }) });

    expect(term?.writes).toEqual(["\r\n\x1b[31m[missing cli]\x1b[0m\r\n"]);
    expect(conn.connView.get("cell-error")).toEqual({ status: "disconnected", serverCwd: "/typed" });
    expect(handlers.onExit).toHaveBeenCalledTimes(1);
  });
});

describe("shiftEnterNewlineDecision", () => {
  it('sends "\\\\r" and suppresses xterm for Shift+Enter keydown', () => {
    expect(conn.shiftEnterNewlineDecision(terminalKeyEvent())).toEqual({ allowXterm: false, input: "\\\r" });
  });

  it("passes plain Enter through to xterm", () => {
    expect(conn.shiftEnterNewlineDecision(terminalKeyEvent({ shiftKey: false }))).toEqual({ allowXterm: true, input: null });
  });

  it("passes Ctrl / Alt / Meta modified Enter through to xterm", () => {
    for (const modifier of ["ctrlKey", "altKey", "metaKey"] as const) {
      expect(conn.shiftEnterNewlineDecision(terminalKeyEvent({ [modifier]: true }))).toEqual({ allowXterm: true, input: null });
    }
  });

  it("passes IME-composing Shift+Enter through to xterm", () => {
    expect(conn.shiftEnterNewlineDecision(terminalKeyEvent({ isComposing: true }))).toEqual({ allowXterm: true, input: null });
    expect(conn.shiftEnterNewlineDecision(terminalKeyEvent({ keyCode: 229 }))).toEqual({ allowXterm: true, input: null });
  });

  it("suppresses Shift+Enter keypress / keyup without sending duplicate input", () => {
    for (const type of ["keypress", "keyup"]) {
      expect(conn.shiftEnterNewlineDecision(terminalKeyEvent({ type }))).toEqual({ allowXterm: false, input: null });
    }
  });
});

describe("Shift+Enter custom key handler", () => {
  beforeEach(() => {
    FakeWebSocket.instances.length = 0;
    terminalInstances.length = 0;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    conn.release("cell-shift-enter");
  });

  it("routes Shift+Enter through the slot's current WebSocket input channel", () => {
    const { ws, term } = attachSlot("cell-shift-enter");
    const result = term?.keyHandlers[0]?.(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true }));

    expect(result).toBe(false);
    expect(ws.sent.at(-1)).toBe(JSON.stringify({ type: "input", data: "\\\r" }));
  });
});

// Claude Code emits OSC 52 with an EMPTY selection; the clipboard addon's default
// provider only writes for "c", so the empty case must also route to the clipboard.
describe("isSystemClipboard", () => {
  it("routes the empty selection (Claude Code's OSC 52) and explicit 'c' to the clipboard", () => {
    expect(conn.isSystemClipboard("")).toBe(true);
    expect(conn.isSystemClipboard("c")).toBe(true);
  });

  it("ignores primary / select / cut-buffer selections", () => {
    for (const sel of ["p", "s", "0", "7"]) expect(conn.isSystemClipboard(sel)).toBe(false);
  });
});

describe("stripReplayQueryResponses", () => {
  it("drops Device Attributes responses produced while replaying scrollback", () => {
    expect(conn.stripReplayQueryResponses("\x1b[?1;2c\x1b[>0;276;0c")).toBeNull();
  });

  it("drops bare Device Attributes fragments seen by shells after replay races", () => {
    expect(conn.stripReplayQueryResponses("1;2c0;276;0c")).toBeNull();
  });

  it("keeps normal input intact", () => {
    expect(conn.stripReplayQueryResponses("echo ok\r")).toBe("echo ok\r");
  });
});
