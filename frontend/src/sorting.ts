/**
 * Pure sorting logic and the two list controls ("Sort by" and "MultiSport cards") shared by
 * the slot panel and the venues page.
 */
import { MULTISPORT_CARD_OPTIONS, comparePayable, isMultisportCards } from '@spotradar/shared';
import type { CourtPrice, MultisportCards } from '@spotradar/shared';

export const SORT_MODES = ['distance', 'price'] as const;
export type SortMode = (typeof SORT_MODES)[number];
export const DEFAULT_SORT: SortMode = 'distance';
export const DEFAULT_CARDS: MultisportCards = 0;

export function isSortMode(value: unknown): value is SortMode {
  return typeof value === 'string' && (SORT_MODES as readonly string[]).includes(value);
}

/** Invalid or missing → distance. */
export function parseSort(value: string | null | undefined): SortMode {
  return isSortMode(value) ? value : DEFAULT_SORT;
}

/** Only the plain integers "0".."4" are valid; anything else → 0. */
export function parseCards(value: string | null | undefined): MultisportCards {
  if (value === null || value === undefined || !/^\d$/.test(value)) return DEFAULT_CARDS;
  const n = Number(value);
  return isMultisportCards(n) ? n : DEFAULT_CARDS;
}

/** What the comparison needs to know about one list entry. */
export interface SortKey {
  name: string;
  /** Distance from the chosen origin; undefined/null = not known. */
  distanceKm?: number | null;
  /** Price of the entry with the chosen cards; null = unknown. */
  price: CourtPrice | null;
}

function compareName(a: string, b: string): number {
  return a.localeCompare(b, 'cs');
}

/** Nearest first, unknown distance last. */
function compareDistance(a: number | null | undefined, b: number | null | undefined): number {
  const x = a ?? null;
  const y = b ?? null;
  if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
  return x - y;
}

/**
 * Returns a sorted copy.
 * - distance: nearest first, ties by name. When no entry has a distance (no location set) the
 *   incoming (default) order is kept.
 * - price: cheapest payable first (unknown last), ties by distance, then name.
 */
export function sortEntries<T>(
  items: readonly T[],
  mode: SortMode,
  key: (item: T) => SortKey,
): T[] {
  const keyed = items.map((item, index) => ({ item, index, key: key(item) }));
  if (mode === 'distance') {
    if (keyed.every((k) => (k.key.distanceKm ?? null) === null)) return [...items];
    keyed.sort(
      (a, b) =>
        compareDistance(a.key.distanceKm, b.key.distanceKm) ||
        compareName(a.key.name, b.key.name) ||
        a.index - b.index,
    );
  } else {
    keyed.sort(
      (a, b) =>
        comparePayable(a.key.price, b.key.price) ||
        compareDistance(a.key.distanceKm, b.key.distanceKm) ||
        compareName(a.key.name, b.key.name) ||
        a.index - b.index,
    );
  }
  return keyed.map((k) => k.item);
}

// ---------- controls (render-to-string) ----------

const SORT_LABELS: Record<SortMode, string> = { distance: 'Distance', price: 'Price' };

/**
 * The two segmented controls. `scope` keeps the data-key (focus restore) unique per place.
 * Buttons carry `data-sort-mode` / `data-cards-count`, handled by one delegated listener.
 */
export function renderListControls(sort: SortMode, cards: MultisportCards, scope: string): string {
  const sortButtons = SORT_MODES.map(
    (mode) =>
      `<button type="button" class="seg-btn" data-sort-mode="${mode}" data-key="${scope}-sort-${mode}" aria-pressed="${sort === mode}">${SORT_LABELS[mode]}</button>`,
  ).join('');
  const cardButtons = MULTISPORT_CARD_OPTIONS.map(
    (n) =>
      `<button type="button" class="seg-btn" data-cards-count="${n}" data-key="${scope}-cards-${n}" aria-pressed="${cards === n}">${n}</button>`,
  ).join('');
  return `<div class="list-controls">
  <div class="list-control"><span class="label" id="${scope}-sort-label">Sort by</span><div class="segmented" role="group" aria-labelledby="${scope}-sort-label">${sortButtons}</div></div>
  <div class="list-control"><span class="label" id="${scope}-cards-label">MultiSport cards</span><div class="segmented" role="group" aria-labelledby="${scope}-cards-label">${cardButtons}</div></div>
</div>`;
}
