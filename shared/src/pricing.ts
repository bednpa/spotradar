/**
 * Structured court prices (part of the API contract) plus pure helpers shared by
 * backend (data validation) and frontend (labels). MultiSport terms live in multisport.ts.
 */
import { isValidTime, timeToMinutes, weekdayOf } from './dates.ts';
import { WEEKDAYS } from './types.ts';
import type { Weekday } from './types.ts';

/** One row of a price list: `price` applies on `days` for start times in [from, to). */
export interface PriceRule {
  /** Non-empty list of weekdays the rule applies to. */
  days: Weekday[];
  /** "HH:MM", inclusive. */
  from: string;
  /** "HH:MM" ("24:00" allowed), exclusive; from < to. */
  to: string;
  /** Whole CZK per `unit` (per court). */
  price: number;
}

/** A venue's court price list. Rules must not overlap; the first matching rule wins. */
export interface Pricing {
  currency: 'CZK';
  unit: 'hour';
  rules: PriceRule[];
  /** Short extra info, e.g. "Students −20 %". */
  note?: string;
}

/** Text shown everywhere when the price is not known. */
export const PRICE_UNKNOWN_LABEL = 'Price on website';

/** Matches the rule containing the start time. `time` is a whole hour (14) or "HH:MM". */
export function priceRuleFor(
  pricing: Pricing | undefined,
  date: string,
  time: number | string,
): PriceRule | null {
  if (!pricing) return null;
  const minutes = typeof time === 'number' ? time * 60 : timeToMinutes(time);
  if (!Number.isFinite(minutes)) return null;
  const day = weekdayOf(date);
  return (
    pricing.rules.find(
      (r) =>
        r.days.includes(day) && timeToMinutes(r.from) <= minutes && minutes < timeToMinutes(r.to),
    ) ?? null
  );
}

/**
 * Price per hour (CZK) of a court starting at `time` ("HH:MM" or whole hour) on `date`
 * ("YYYY-MM-DD"); null when unknown (no pricing or no rule matches).
 */
export function priceFor(
  pricing: Pricing | undefined,
  date: string,
  time: number | string,
): number | null {
  return priceRuleFor(pricing, date, time)?.price ?? null;
}

/** Lowest price of the list; null when unknown. */
export function minPrice(pricing: Pricing | undefined): number | null {
  if (!pricing || pricing.rules.length === 0) return null;
  return Math.min(...pricing.rules.map((r) => r.price));
}

/** 380 → "380 Kč" (rounded to whole crowns). */
export function formatCzk(amount: number): string {
  return `${Math.round(amount)} Kč`;
}

/** 380 → "380 Kč / h"; null → PRICE_UNKNOWN_LABEL. */
export function formatHourlyPrice(price: number | null): string {
  return price === null ? PRICE_UNKNOWN_LABEL : `${formatCzk(price)} / h`;
}

/** Short form for lists/detail: "from 280 Kč / h", or PRICE_UNKNOWN_LABEL. */
export function formatPriceFrom(pricing: Pricing | undefined): string {
  const min = minPrice(pricing);
  return min === null ? PRICE_UNKNOWN_LABEL : `from ${formatHourlyPrice(min)}`;
}

const DAY_SHORT: Record<Weekday, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
};

/** ["mon",…,"fri"] → "Mon–Fri"; ["sat","sun"] → "Sat–Sun"; ["mon","wed"] → "Mon, Wed". */
export function formatDays(days: readonly Weekday[]): string {
  const idx = [...new Set(days)].map((d) => WEEKDAYS.indexOf(d)).sort((a, b) => a - b);
  const groups: string[] = [];
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1] === (idx[j] ?? 0) + 1) j++;
    const a = DAY_SHORT[WEEKDAYS[idx[i] ?? 0] ?? 'mon'];
    const b = DAY_SHORT[WEEKDAYS[idx[j] ?? 0] ?? 'mon'];
    if (j === i) groups.push(a);
    else if (j === i + 1) groups.push(`${a}, ${b}`);
    else groups.push(`${a}–${b}`);
    i = j + 1;
  }
  return groups.join(', ');
}

/** One row of the full price table, e.g. "Mon–Fri 07:00–15:00: 280 Kč / h". */
export function formatPriceRule(rule: PriceRule): string {
  return `${formatDays(rule.days)} ${rule.from}–${rule.to}: ${formatHourlyPrice(rule.price)}`;
}

/** Problems of a price list (empty = valid): times, day lists, prices and overlaps. */
export function validatePricing(pricing: Pricing): string[] {
  const issues: string[] = [];
  const isTime = (t: string): boolean => t === '24:00' || isValidTime(t);
  pricing.rules.forEach((r, i) => {
    if (r.days.length === 0) issues.push(`rule ${i}: no days`);
    if (r.days.some((d) => !WEEKDAYS.includes(d))) issues.push(`rule ${i}: unknown day`);
    if (!isTime(r.from) || !isTime(r.to)) issues.push(`rule ${i}: invalid time`);
    else if (timeToMinutes(r.from) >= timeToMinutes(r.to)) issues.push(`rule ${i}: from ≥ to`);
    if (!Number.isInteger(r.price) || r.price < 0) issues.push(`rule ${i}: invalid price`);
  });
  if (pricing.rules.length === 0) issues.push('no rules');
  for (let i = 0; i < pricing.rules.length; i++) {
    for (let j = i + 1; j < pricing.rules.length; j++) {
      const a = pricing.rules[i];
      const b = pricing.rules[j];
      if (!a || !b || !a.days.some((d) => b.days.includes(d))) continue;
      if (
        timeToMinutes(a.from) < timeToMinutes(b.to) &&
        timeToMinutes(b.from) < timeToMinutes(a.to)
      ) {
        issues.push(`rules ${i} and ${j} overlap`);
      }
    }
  }
  return issues;
}
