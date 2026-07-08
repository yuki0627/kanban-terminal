import { ref } from "vue";

// Board-wide card density: small / medium / large. Medium reproduces the shipped
// card layout and is the default. A singleton ref shared across toolbars and the
// board, persisted to localStorage so the choice survives reloads — the same
// pattern as useTheme / useSoundEnabled.
export type CardSizeId = "s" | "m" | "l";

export const CARD_SIZES: { id: CardSizeId; label: string; icon: string }[] = [
  { id: "s", label: "Small", icon: "density_small" },
  { id: "m", label: "Medium", icon: "density_medium" },
  { id: "l", label: "Large", icon: "density_large" },
];

const STORAGE_KEY = "card_size";
const DEFAULT_SIZE: CardSizeId = "m";

export function isCardSizeId(value: unknown): value is CardSizeId {
  return value === "s" || value === "m" || value === "l";
}

// Storage access can throw (private mode / sandboxed contexts with storage
// blocked), so persistence is best-effort: a failure falls back to the default
// rather than crashing.
function loadCardSize(): CardSizeId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isCardSizeId(stored) ? stored : DEFAULT_SIZE;
  } catch {
    return DEFAULT_SIZE;
  }
}

const cardSize = ref<CardSizeId>(loadCardSize());

export function useCardSize() {
  function setCardSize(id: CardSizeId) {
    cardSize.value = id;
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // storage blocked: the size still applies for this session, just isn't persisted
    }
  }
  return { cardSize, sizes: CARD_SIZES, setCardSize };
}
