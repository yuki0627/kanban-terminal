import type { BoardState } from "./board-store.js";

export interface AgentTranscriptCandidate {
  id: string;
  createdAt: number;
  updatedAt: number;
  title: string | null;
}

export function linkedAgentSessionIds(board: BoardState, exceptCardId: string): Set<string> {
  const ids = new Set<string>();
  for (const card of board.cards) {
    const id = card.terminal.agentSessionId;
    if (card.id !== exceptCardId && id) ids.add(id);
  }
  return ids;
}

export function selectAgentTranscriptCandidate(
  candidates: ReadonlyArray<AgentTranscriptCandidate>,
  startedAt: number,
  linkedIds: ReadonlySet<string>,
  lookbackMs: number,
): AgentTranscriptCandidate | null {
  const earliest = startedAt - lookbackMs;
  const eligible = candidates.filter((candidate) => {
    if (linkedIds.has(candidate.id)) return false;
    return candidate.createdAt >= earliest || candidate.updatedAt >= earliest;
  });
  eligible.sort((a, b) => Math.abs(a.createdAt - startedAt) - Math.abs(b.createdAt - startedAt));
  return eligible[0] ?? null;
}
