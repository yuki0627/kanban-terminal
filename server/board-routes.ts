import type { Express } from "express";
import type { createPubSub } from "./pubsub.js";
import { loadBoard, saveBoard, sanitizeBoard, type BoardState } from "./board-store.js";

export const BOARD_CHANNEL = "board";

interface BoardRoutesOptions {
  pubsub: ReturnType<typeof createPubSub>;
  onSaved?: () => void;
  prepareBoard?: (board: BoardState) => BoardState;
}

export function mountBoardRoutes(app: Express, { pubsub, onSaved, prepareBoard }: BoardRoutesOptions): void {
  app.get("/api/board", (_req, res) => {
    const loaded = loadBoard();
    const board = prepareBoard ? prepareBoard(loaded) : loaded;
    if (board !== loaded) saveBoard(board);
    res.json(board);
  });

  app.put("/api/board", (req, res) => {
    const sanitized = sanitizeBoard(req.body ?? {});
    const board = prepareBoard ? prepareBoard(sanitized) : sanitized;
    if (!saveBoard(board)) return res.status(500).json({ error: "failed to persist board" });
    onSaved?.();
    pubsub.publish(BOARD_CHANNEL, { event: "updated", at: Date.now() });
    res.json(board);
  });
}
