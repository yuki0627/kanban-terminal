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
