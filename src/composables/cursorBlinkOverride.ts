// Claude Code (and other TUIs) ask the terminal for a NON-blinking cursor via
// DECSCUSR (CSI Ps SP q — even params mean "steady") or DECRST 12 (CSI ? 12 l).
// xterm honors those at the DEC-private-mode level, which overrides our
// `cursorBlink: true` option, so the focused cursor never blinks (macOS Terminal
// behaves the same way; Ghostty blinks because it force-overrides the app).
// The blink is this app's character-level focus signal, so like Ghostty we keep
// it: apply the SHAPE the app asks for, but never let the blink-off through.
import type { Terminal } from "@xterm/xterm";

type CursorShape = "block" | "underline" | "bar";

// DECSCUSR param → shape. Steady (even) and blinking (odd) variants share a
// shape; the steady/blinking half is deliberately ignored. 0 = default (block).
const DECSCUSR_SHAPE: Record<number, CursorShape> = {
  0: "block",
  1: "block",
  2: "block",
  3: "underline",
  4: "underline",
  5: "bar",
  6: "bar",
};

export function forceCursorBlink(term: Terminal): void {
  term.parser.registerCsiHandler({ intermediates: " ", final: "q" }, (params) => {
    const p = params[0] ?? 0;
    const shape = typeof p === "number" ? DECSCUSR_SHAPE[p] : undefined;
    if (!shape) return false; // unknown param — let xterm handle it
    term.options.cursorStyle = shape;
    return true; // handled: xterm's own DECSCUSR (which would stop the blink) never runs
  });
  // DECRST 12 = "stop cursor blink": swallow it. Every other private mode falls
  // through to xterm. A multi-param reset that bundles 12 with other modes also
  // falls through (real emitters send single-mode sequences); swallowing it would
  // wrongly eat the other modes too.
  term.parser.registerCsiHandler({ prefix: "?", final: "l" }, (params) => params.length === 1 && params[0] === 12);
}
