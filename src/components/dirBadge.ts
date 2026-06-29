// Inline style for a directory's name badge: the configured color as the
// background, with black or white text picked for contrast. Shared by the single
// view (Terminal header) and the grid (cell header) so the badge looks the same in
// both. A null/missing color falls back to a neutral panel chip.

// sRGB relative luminance (WCAG): bright backgrounds get dark text, dark ones light.
function isLight(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 150;
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function badgeStyleFor(color: string | null | undefined): Record<string, string> {
  if (!color || !HEX_COLOR_RE.test(color)) {
    return { background: "var(--bg-elevated)", color: "var(--text-secondary)" };
  }
  return { background: color, color: isLight(color) ? "#000" : "#fff" };
}
