import { describe, expect, it } from "vitest";
import { AGENT_OUTPUT_CONFIRM_MS, AGENT_SILENCE_MS, emptyAgentPtyActivityState, reduceAgentPtyActivity } from "./pty-activity.js";

describe("reduceAgentPtyActivity", () => {
  it("emits working when enough output chunks follow Enter within the confirmation window", () => {
    let state = reduceAgentPtyActivity(emptyAgentPtyActivityState(), { type: "enter", at: 1000 }).state;
    state = reduceAgentPtyActivity(state, { type: "output", at: 1100 }).state;
    state = reduceAgentPtyActivity(state, { type: "output", at: 1200 }).state;
    const result = reduceAgentPtyActivity(state, { type: "output", at: 1300 });
    expect(result.signal).toBe("working");
    expect(result.state.working).toBe(true);
  });

  it("emits done when a working agent stays silent longer than the silence threshold", () => {
    let state = reduceAgentPtyActivity(emptyAgentPtyActivityState(), { type: "enter", at: 1000 }).state;
    state = reduceAgentPtyActivity(state, { type: "output", at: 1100 }).state;
    state = reduceAgentPtyActivity(state, { type: "output", at: 1200 }).state;
    state = reduceAgentPtyActivity(state, { type: "output", at: 1300 }).state;
    const result = reduceAgentPtyActivity(state, { type: "silence", at: 1300 + AGENT_SILENCE_MS + 1 });
    expect(result.signal).toBe("done");
    expect(result.state.working).toBe(false);
  });

  it("does not emit working for output that is not preceded by Enter", () => {
    let state = emptyAgentPtyActivityState();
    state = reduceAgentPtyActivity(state, { type: "output", at: 1000 }).state;
    state = reduceAgentPtyActivity(state, { type: "output", at: 1100 }).state;
    const result = reduceAgentPtyActivity(state, { type: "output", at: 1200 });
    expect(result.signal).toBeNull();
    expect(result.state.working).toBe(false);
  });

  it("does not emit working when output starts after the confirmation window", () => {
    const state = reduceAgentPtyActivity(emptyAgentPtyActivityState(), { type: "enter", at: 1000 }).state;
    const result = reduceAgentPtyActivity(state, { type: "output", at: 1000 + AGENT_OUTPUT_CONFIRM_MS + 1 });
    expect(result.signal).toBeNull();
    expect(result.state.working).toBe(false);
  });
});
