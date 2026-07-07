import { describe, expect, it } from "vitest";
import { linkedAgentSessionIds, selectAgentTranscriptCandidate, type AgentTranscriptCandidate } from "./agent-discovery";
import { sanitizeBoard } from "./board-store.js";

const candidate = (id: string, createdAt: number, updatedAt = createdAt): AgentTranscriptCandidate => ({ id, createdAt, updatedAt, title: null });

describe("selectAgentTranscriptCandidate", () => {
  it("can discover transcripts written after a delayed first prompt", () => {
    const selected = selectAgentTranscriptCandidate([candidate("early", 1_000), candidate("prompted", 70_000, 70_000)], 70_000, new Set(), 5_000);
    expect(selected?.id).toBe("prompted");
  });

  it("skips session ids that are already linked to other cards", () => {
    const selected = selectAgentTranscriptCandidate([candidate("taken", 10_050), candidate("free", 10_100)], 10_000, new Set(["taken"]), 5_000);
    expect(selected?.id).toBe("free");
  });

  it("chooses the closest eligible transcript by creation time", () => {
    const selected = selectAgentTranscriptCandidate([candidate("far", 9_000), candidate("near", 10_050)], 10_000, new Set(), 5_000);
    expect(selected?.id).toBe("near");
  });

  it("accepts a transcript created before the lookback window when it was updated inside it", () => {
    const selected = selectAgentTranscriptCandidate([candidate("refreshed", 1_000, 9_500), candidate("stale", 8_000, 8_999)], 10_000, new Set(), 1_000);
    expect(selected).toEqual({ id: "refreshed", createdAt: 1_000, updatedAt: 9_500, title: null });
  });

  it("returns null when every candidate is linked or outside the lookback window", () => {
    const selected = selectAgentTranscriptCandidate([candidate("linked", 10_000), candidate("old", 1_000, 8_999)], 10_000, new Set(["linked"]), 1_000);
    expect(selected).toBeNull();
  });
});

describe("linkedAgentSessionIds", () => {
  it("excludes the current card so title retries can revisit its own transcript", () => {
    const board = sanitizeBoard({
      cards: [
        { id: "current", terminal: { agentSessionId: "same" } },
        { id: "other", terminal: { agentSessionId: "taken" } },
      ],
    });
    expect(linkedAgentSessionIds(board, "current")).toEqual(new Set(["taken"]));
  });
});
