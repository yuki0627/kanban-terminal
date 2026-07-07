export const AGENT_OUTPUT_CONFIRM_MS = 1500;
export const AGENT_MIN_CHUNKS = 3;
export const AGENT_SILENCE_MS = 2000;

export type AgentPtySignal = "working" | "done";

export interface AgentPtyActivityState {
  pendingSince: number | null;
  pendingChunks: number;
  working: boolean;
  lastOutputAt: number | null;
}

export type AgentPtyActivityEvent = { type: "enter"; at: number } | { type: "output"; at: number } | { type: "silence"; at: number };

export interface AgentPtyActivityResult {
  state: AgentPtyActivityState;
  signal: AgentPtySignal | null;
}

export const emptyAgentPtyActivityState = (): AgentPtyActivityState => ({
  pendingSince: null,
  pendingChunks: 0,
  working: false,
  lastOutputAt: null,
});

export function reduceAgentPtyActivity(state: AgentPtyActivityState, event: AgentPtyActivityEvent): AgentPtyActivityResult {
  if (event.type === "enter") {
    return {
      state: { pendingSince: event.at, pendingChunks: 0, working: state.working, lastOutputAt: state.lastOutputAt },
      signal: null,
    };
  }

  if (event.type === "output") {
    if (state.working) {
      return { state: { ...state, lastOutputAt: event.at }, signal: null };
    }
    if (state.pendingSince === null || event.at - state.pendingSince > AGENT_OUTPUT_CONFIRM_MS) {
      return { state: emptyAgentPtyActivityState(), signal: null };
    }
    const pendingChunks = state.pendingChunks + 1;
    const working = pendingChunks >= AGENT_MIN_CHUNKS;
    return {
      state: { pendingSince: working ? null : state.pendingSince, pendingChunks: working ? 0 : pendingChunks, working, lastOutputAt: event.at },
      signal: working ? "working" : null,
    };
  }

  if (state.working && state.lastOutputAt !== null && event.at - state.lastOutputAt > AGENT_SILENCE_MS) {
    return { state: emptyAgentPtyActivityState(), signal: "done" };
  }
  return { state, signal: null };
}
