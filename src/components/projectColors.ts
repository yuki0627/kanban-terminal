/**
 * Project color palette shown in the sidebar context menu.
 * Google Calendar's 24 calendar colors, ordered by hue so the
 * 6-column grid reads as a smooth spectrum.
 */
export const PROJECT_COLORS = [
  "#ad1457", // beetroot
  "#d81b60", // cherry blossom
  "#e67c73", // flamingo
  "#d50000", // tomato
  "#f4511e", // tangerine
  "#ef6c00", // pumpkin
  "#f09300", // mango
  "#f6bf26", // banana
  "#e4c441", // citron
  "#c0ca33", // avocado
  "#7cb342", // pistachio
  "#0b8043", // basil
  "#33b679", // sage
  "#009688", // eucalyptus
  "#039be5", // peacock
  "#4285f4", // cobalt
  "#7986cb", // lavender
  "#3f51b5", // blueberry
  "#b39ddb", // wisteria
  "#9e69af", // amethyst
  "#8e24aa", // grape
  "#795548", // cocoa
  "#616161", // graphite
  "#a79b8e", // birch
];

/**
 * Rotation for auto-assigning colors to new projects. A hue-spread
 * subset of PROJECT_COLORS so consecutive projects stay distinguishable
 * and the assigned color highlights as "current" in the picker.
 */
export const AUTO_ASSIGN_COLORS = [
  "#4285f4", // cobalt
  "#0b8043", // basil
  "#d50000", // tomato
  "#8e24aa", // grape
  "#ef6c00", // pumpkin
  "#009688", // eucalyptus
  "#3f51b5", // blueberry
  "#d81b60", // cherry blossom
];

export function autoProjectColor(index: number): string {
  return AUTO_ASSIGN_COLORS[index % AUTO_ASSIGN_COLORS.length];
}
