// Map the server's raw activity to a card/cell status. `waiting` means "needs
// the user"; the event that set it distinguishes a permission/question pause
// ("Notification" -> blocked) from a finished-but-unreviewed turn ("Stop" -> done).
export type CellStatus = "blocked" | "done" | "working" | "idle";

export function activityStatus(working: boolean, waiting: boolean, event: string | null | undefined): CellStatus {
  if (waiting) return event === "Notification" ? "blocked" : "done";
  if (working) return "working";
  return "idle";
}
