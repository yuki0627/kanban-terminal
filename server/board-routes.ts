import type { Express } from "express";
import type { createPubSub } from "./pubsub.js";
import { loadBoard, saveBoard, sanitizeBoard } from "./board-store.js";

export const BOARD_CHANNEL = "board";

interface BoardRoutesOptions {
  pubsub: ReturnType<typeof createPubSub>;
  onSaved?: () => void;
}

export function mountBoardRoutes(app: Express, { pubsub, onSaved }: BoardRoutesOptions): void {
  app.get("/api/board", (_req, res) => {
    res.json(loadBoard());
  });

  app.put("/api/board", (req, res) => {
    const board = sanitizeBoard(req.body ?? {});
    if (!saveBoard(board)) return res.status(500).json({ error: "failed to persist board" });
    onSaved?.();
    pubsub.publish(BOARD_CHANNEL, { event: "updated", at: Date.now() });
    res.json(board);
  });
}
