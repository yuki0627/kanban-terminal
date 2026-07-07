import type { Express } from "express";
import type { createPubSub } from "./pubsub.js";
import { loadBoard, markCardRead, saveBoard, sanitizeBoard, type BoardState } from "./board-store.js";

export const BOARD_CHANNEL = "board";
const CARD_ID_RE = /^[A-Za-z0-9_.:-]{1,160}$/;

interface BoardRoutesOptions {
  isAllowedOrigin: (origin?: string) => boolean;
  isCardViewed?: (cardId: string) => boolean;
  pubsub: ReturnType<typeof createPubSub>;
  onSaved?: () => void;
  onCardClosed?: (cardId: string) => void;
  onCardRead?: (cardId: string) => void;
  prepareBoard?: (board: BoardState) => BoardState;
}

function clearViewedUnread(board: BoardState, isCardViewed: ((cardId: string) => boolean) | undefined): BoardState {
  if (!isCardViewed) return board;
  let changed = false;
  const cards = board.cards.map((card) => {
    if (!card.unread || !isCardViewed(card.id)) return card;
    changed = true;
    return { ...card, unread: false, updatedAt: Date.now() };
  });
  return changed ? { ...board, cards } : board;
}

export function mountBoardRoutes(
  app: Express,
  { isAllowedOrigin, isCardViewed, pubsub, onSaved, onCardClosed, onCardRead, prepareBoard }: BoardRoutesOptions,
): void {
  app.get("/api/board", (_req, res) => {
    const loaded = loadBoard();
    const board = prepareBoard ? prepareBoard(loaded) : loaded;
    if (board !== loaded) saveBoard(board);
    res.json(board);
  });

  app.put("/api/board", (req, res) => {
    if (!isAllowedOrigin(req.headers.origin)) return res.status(403).json({ error: "forbidden origin" });

    const sanitized = sanitizeBoard(req.body ?? {});
    const prepared = prepareBoard ? prepareBoard(sanitized) : sanitized;
    const board = clearViewedUnread(prepared, isCardViewed);
    if (!saveBoard(board)) return res.status(500).json({ error: "failed to persist board" });
    onSaved?.();
    pubsub.publish(BOARD_CHANNEL, { event: "updated", at: Date.now() });
    res.json(board);
  });

  app.post("/api/board/card/:id/read", (req, res) => {
    if (!isAllowedOrigin(req.headers.origin)) return res.status(403).json({ error: "forbidden origin" });

    const cardId = typeof req.params.id === "string" && CARD_ID_RE.test(req.params.id) ? req.params.id : null;
    if (!cardId) return res.status(400).json({ error: "invalid card id" });
    const loaded = loadBoard();
    const prepared = prepareBoard ? prepareBoard(loaded) : loaded;
    const board = markCardRead(prepared, cardId);
    if (!saveBoard(board)) return res.status(500).json({ error: "failed to persist board" });
    onSaved?.();
    onCardRead?.(cardId);
    pubsub.publish(BOARD_CHANNEL, { event: "updated", at: Date.now() });
    res.json(board);
  });

  app.post("/api/board/card/:id/close", (req, res) => {
    const cardId = typeof req.params.id === "string" && CARD_ID_RE.test(req.params.id) ? req.params.id : null;
    if (!cardId) return res.status(400).json({ error: "invalid card id" });
    onCardClosed?.(cardId);
    res.json({ ok: true });
  });
}
