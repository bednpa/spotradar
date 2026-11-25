/**
 * MultiSport card terms (part of the API contract) and the pure court-price
 * calculation shared by backend (data validation) and frontend (labels, sorting).
 *
 * A venue's terms are one *category* saying what N cards are worth for one court-hour,
 * plus structured limits where they are known. Unknown terms stay `unknown` – never guess.
 */
import { formatCzk, priceFor, PRICE_UNKNOWN_LABEL } from './pricing.ts';
import type { Pricing } from './pricing.ts';

export const MULTISPORT_CATEGORIES = [
  'half-per-card',
  'full-two-cards',
  'minutes-per-card',
  'not-accepted',
  'unknown',
] as const;
export type MultisportCategory = (typeof MULTISPORT_CATEGORIES)[number];

/** Options of the "MultiSport cards" control: cards the group uses for one court (default 0). */
export const MULTISPORT_CARD_OPTIONS = [0, 1, 2, 3, 4] as const;
export type MultisportCards = (typeof MULTISPORT_CARD_OPTIONS)[number];
export const MAX_MULTISPORT_CARDS = 4;

export function isMultisportCards(value: unknown): value is MultisportCards {
  return (
    typeof value === 'number' && (MULTISPORT_CARD_OPTIONS as readonly number[]).includes(value)
  );
}

/** Structured limits of an accepting venue; every field is optional (absent = not known / none). */
export interface MultisportLimits {
  /** At most this many cards are accepted for one court (per booking hour). */
  maxCardsPerCourt?: number;
  /** At most this many players may use one court. Also caps the useful cards. */
  maxPlayersPerCourt?: number;
  /** Bookings paid with cards must be at least this long. */
  minBookingMinutes?: number;
  /** Bookings paid with cards must be exactly this long (e.g. 60). */
  onlyBookingMinutes?: number;
  /** Players must tell the staff in advance (when booking) that they will pay with cards. */
  requiresNotice?: boolean;
}

interface AcceptedTerms {
  limits?: MultisportLimits;
  /** Only for terms that really do not fit the structured fields. */
  note?: string;
}

/**
 * Whether and how a venue accepts the MultiSport card for the sport.
 *
 * The category set was picked from the real Brno venue data (2026-11-25): no venue gives a
 * fixed amount per card, so there is no such category. `half-per-card` and `full-two-cards`
 * compute the same (each card covers half, so at most 2 cards are useful); they differ in how
 * the venue states its terms, and `full-two-cards` venues explicitly allow 2 cards per court.
 */
export type MultisportInfo =
  /** Each card covers 50 % of the court-hour price ("1 card = 50 % off"). */
  | ({ category: 'half-per-card' } & AcceptedTerms)
  /** Two cards cover the whole court-hour ("2 cards = free"); one card covers half. */
  | ({ category: 'full-two-cards' } & AcceptedTerms)
  /** Each card covers `minutesPerCard` minutes of court time ("1 card = 30 min"). */
  | ({ category: 'minutes-per-card'; minutesPerCard: number } & AcceptedTerms)
  | { category: 'not-accepted'; note?: string }
  | { category: 'unknown'; note?: string };

export const MULTISPORT_UNKNOWN: MultisportInfo = { category: 'unknown' };
export const MULTISPORT_UNKNOWN_LABEL = 'MultiSport: unknown';
export const MULTISPORT_NOT_ACCEPTED_LABEL = 'No MultiSport';

/** True for the categories where cards reduce the price. */
export function acceptsMultisport(info: MultisportInfo | undefined): boolean {
  return info !== undefined && info.category !== 'not-accepted' && info.category !== 'unknown';
}

/**
 * The short category badge text: "1 card = 50 % off", "2 cards = free", "1 card = 30 min",
 * "No MultiSport", "MultiSport: unknown" (also for `undefined`).
 */
export function formatMultisport(info: MultisportInfo | undefined): string {
  switch (info?.category) {
    case 'half-per-card':
      return '1 card = 50 % off';
    case 'full-two-cards':
      return '2 cards = free';
    case 'minutes-per-card':
      return `1 card = ${info.minutesPerCard} min`;
    case 'not-accepted':
      return MULTISPORT_NOT_ACCEPTED_LABEL;
    case 'unknown':
    case undefined:
      return MULTISPORT_UNKNOWN_LABEL;
  }
}

/**
 * The limits and note as short phrases for a tooltip/expand, in a fixed order, e.g.
 * ["max 2 cards per court", "max 4 players per court", "60-min bookings only",
 *  "tell staff in advance", <note>]. Empty when there is nothing to say.
 */
export function formatMultisportLimits(info: MultisportInfo | undefined): string[] {
  if (!info) return [];
  const parts: string[] = [];
  if ('limits' in info && info.limits) {
    const l = info.limits;
    if (l.maxCardsPerCourt !== undefined) {
      parts.push(
        `max ${l.maxCardsPerCourt} ${l.maxCardsPerCourt === 1 ? 'card' : 'cards'} per court`,
      );
    }
    if (l.maxPlayersPerCourt !== undefined) {
      parts.push(`max ${l.maxPlayersPerCourt} players per court`);
    }
    if (l.onlyBookingMinutes !== undefined) parts.push(`${l.onlyBookingMinutes}-min bookings only`);
    if (l.minBookingMinutes !== undefined) parts.push(`min. ${l.minBookingMinutes}-min booking`);
    if (l.requiresNotice) parts.push('tell staff in advance');
  }
  if (info.note) parts.push(info.note);
  return parts;
}

/** Price of one court for one hour for a group using some MultiSport cards. */
export interface CourtPrice {
  /** Court-hour price from the price list (CZK). */
  basePrice: number;
  /** Cards that actually reduce the price (≤ requested, capped by the venue's terms/limits). */
  cardsUsed: number;
  /** What the group pays after the cards (CZK, whole crowns, never below 0). */
  payable: number;
}

/** CZK one card takes off a court-hour priced `basePrice`, and how many cards are useful at most. */
function cardValue(
  basePrice: number,
  info: MultisportInfo,
): { perCard: number; maxUseful: number } | null {
  switch (info.category) {
    case 'half-per-card':
    case 'full-two-cards':
      return { perCard: basePrice / 2, maxUseful: 2 };
    case 'minutes-per-card': {
      const m = info.minutesPerCard;
      if (!(m > 0)) return null;
      return { perCard: (basePrice * m) / 60, maxUseful: Math.ceil(60 / m) };
    }
    case 'not-accepted':
    case 'unknown':
      return null;
  }
}

/**
 * Applies `cards` MultiSport cards to a known court-hour price. Cards beyond the venue's
 * limits (maxCardsPerCourt, maxPlayersPerCourt) or beyond what is needed to make the court
 * free are not used. Unknown / not-accepted MultiSport → the base price with `cardsUsed: 0`.
 */
export function applyMultisport(
  basePrice: number,
  multisport: MultisportInfo | undefined,
  cards: number,
): CourtPrice {
  const requested = Number.isFinite(cards) ? Math.max(0, Math.floor(cards)) : 0;
  const value = multisport && basePrice > 0 ? cardValue(basePrice, multisport) : null;
  if (!multisport || !value || requested === 0) {
    return { basePrice, cardsUsed: 0, payable: basePrice };
  }
  const limits = 'limits' in multisport ? multisport.limits : undefined;
  const cardsUsed = Math.min(
    requested,
    value.maxUseful,
    limits?.maxCardsPerCourt ?? Infinity,
    limits?.maxPlayersPerCourt ?? Infinity,
  );
  const payable = Math.max(0, Math.round(basePrice - cardsUsed * value.perCard));
  return { basePrice, cardsUsed, payable };
}

export interface CourtPriceInput {
  pricing: Pricing | undefined;
  multisport: MultisportInfo | undefined;
  /** "YYYY-MM-DD" */
  date: string;
  /** Start hour of the court-hour (0–23). */
  hour: number;
  /** Cards the group uses for the court (0–MAX_MULTISPORT_CARDS). */
  cards: number;
}

/** Price of the court-hour starting at `hour` on `date` with `cards` cards; null when the price is unknown. */
export function courtPrice({
  pricing,
  multisport,
  date,
  hour,
  cards,
}: CourtPriceInput): CourtPrice | null {
  const base = priceFor(pricing, date, hour);
  return base === null ? null : applyMultisport(base, multisport, cards);
}

/**
 * The cheapest court-hour of the whole price list with `cards` cards (lowest `payable`,
 * ties by lower base price) – the venue list's "from" price. Null when the price is unknown.
 */
export function courtPriceFrom(
  pricing: Pricing | undefined,
  multisport: MultisportInfo | undefined,
  cards: number,
): CourtPrice | null {
  if (!pricing) return null;
  let best: CourtPrice | null = null;
  for (const rule of pricing.rules) {
    const p = applyMultisport(rule.price, multisport, cards);
    if (
      best === null ||
      p.payable < best.payable ||
      (p.payable === best.payable && p.basePrice < best.basePrice)
    ) {
      best = p;
    }
  }
  return best;
}

/** Sort helper: cheaper `payable` first, unknown (null) last; 0 when equal (caller breaks ties). */
export function comparePayable(a: CourtPrice | null, b: CourtPrice | null): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  return a.payable - b.payable;
}

/**
 * "400 Kč / h" (no card used), "400 Kč → 200 Kč" (cards used), or PRICE_UNKNOWN_LABEL.
 */
export function formatCourtPrice(price: CourtPrice | null): string {
  if (price === null) return PRICE_UNKNOWN_LABEL;
  if (price.cardsUsed === 0) return `${formatCzk(price.basePrice)} / h`;
  return `${formatCzk(price.basePrice)} → ${formatCzk(price.payable)}`;
}

/** "with 1 card" / "with 2 cards"; "" when no card is used. */
export function formatCardsUsed(cardsUsed: number): string {
  if (cardsUsed <= 0) return '';
  return `with ${cardsUsed} ${cardsUsed === 1 ? 'card' : 'cards'}`;
}

/** Problems of a venue's MultiSport data (empty = valid). */
export function validateMultisport(info: MultisportInfo): string[] {
  const issues: string[] = [];
  const positiveInt = (n: number | undefined): boolean =>
    n === undefined || (Number.isInteger(n) && n > 0);
  if (!(MULTISPORT_CATEGORIES as readonly string[]).includes(info.category)) {
    issues.push('unknown category');
    return issues;
  }
  if (info.category === 'minutes-per-card') {
    if (!positiveInt(info.minutesPerCard) || info.minutesPerCard > 60) {
      issues.push('minutesPerCard must be an integer 1–60');
    }
  }
  if ('limits' in info && info.limits) {
    const l = info.limits;
    if (!positiveInt(l.maxCardsPerCourt))
      issues.push('maxCardsPerCourt must be a positive integer');
    if (!positiveInt(l.maxPlayersPerCourt)) {
      issues.push('maxPlayersPerCourt must be a positive integer');
    }
    if (!positiveInt(l.minBookingMinutes)) {
      issues.push('minBookingMinutes must be a positive integer');
    }
    if (!positiveInt(l.onlyBookingMinutes)) {
      issues.push('onlyBookingMinutes must be a positive integer');
    }
    if (l.minBookingMinutes !== undefined && l.onlyBookingMinutes !== undefined) {
      issues.push('use either minBookingMinutes or onlyBookingMinutes');
    }
  }
  if (info.note !== undefined && info.note.trim() === '') issues.push('empty note');
  return issues;
}
