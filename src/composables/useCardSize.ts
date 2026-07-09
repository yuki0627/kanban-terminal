import { ref } from "vue";

// Board-wide card density: small / medium / large. Medium reproduces the shipped
// card layout and is the default. A singleton ref shared across toolbars and the
// board, persisted to localStorage so the choice survives reloads — the same
// pattern as useTheme / useSoundEnabled.
export type CardSizeId = "s" | "m" | "l";

export const CARD_SIZES: { id: CardSizeId; label: string }[] = [
  { id: "s", label: "Small" },
  { id: "m", label: "Medium" },
  { id: "l", label: "Large" },
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
  // Cycles s -> m -> l -> s, used by the toolbar's single cycle-toggle button.
  function cycleCardSize() {
    const index = CARD_SIZES.findIndex((s) => s.id === cardSize.value);
    const next = CARD_SIZES[(index + 1) % CARD_SIZES.length];
    setCardSize(next.id);
  }
  return { cardSize, sizes: CARD_SIZES, setCardSize, cycleCardSize };
}
