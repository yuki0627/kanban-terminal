// Card memo preview is density-dependent: hidden at "s", clamped to N lines at
// "m"/"l", with a toggle surfaced only when the memo actually overflows that
// clamp. These helpers are pure so the line-counting/overflow rules can be
// unit-tested without mounting the board.
import type { CardSizeId } from "../composables/useCardSize";

export function memoLineCount(memo: string): number {
  const trimmed = memo.trim();
  return trimmed === "" ? 0 : trimmed.split("\n").length;
}

export function memoClampLines(size: CardSizeId): number {
  if (size === "m") return 1;
  if (size === "l") return 3;
  return 0;
}

export function memoHasOverflow(memo: string, size: CardSizeId): boolean {
  const clamp = memoClampLines(size);
  return clamp > 0 && memoLineCount(memo) > clamp;
}
