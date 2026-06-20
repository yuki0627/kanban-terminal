// Grid layout definitions shared by App (the picker) and TerminalGrid.

export const LAYOUTS = ["2x2", "3x2", "4x2", "3x3"] as const;
export type Layout = (typeof LAYOUTS)[number];

// cols × rows per layout. Max cells is 9 (3x3), which bounds the persisted arrays.
const DIMS: Record<Layout, { cols: number; rows: number }> = {
  "2x2": { cols: 2, rows: 2 },
  "3x2": { cols: 3, rows: 2 },
  "4x2": { cols: 4, rows: 2 },
  "3x3": { cols: 3, rows: 3 },
};

export const MAX_CELLS = 9;

export function isLayout(v: unknown): v is Layout {
  return typeof v === "string" && (LAYOUTS as readonly string[]).includes(v);
}

export function dims(layout: Layout) {
  const { cols, rows } = DIMS[layout];
  return { cols, rows, cellCount: cols * rows };
}

// CSS grid track template for the layout, or — when a cell is zoomed — collapse
// every other track to 0fr so that cell fills the area (animated by the caller).
export function trackStyle(layout: Layout, expanded: number | null) {
  const { cols, rows } = dims(layout);
  const tracks = (count: number, active: number) => Array.from({ length: count }, (_, n) => (active < 0 || n === active ? "1fr" : "0fr")).join(" ");
  if (expanded === null) {
    return { gridTemplateColumns: tracks(cols, -1), gridTemplateRows: tracks(rows, -1), gap: "6px" };
  }
  return {
    gridTemplateColumns: tracks(cols, expanded % cols),
    gridTemplateRows: tracks(rows, Math.floor(expanded / cols)),
    gap: "0px",
  };
}
