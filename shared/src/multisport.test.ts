import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MULTISPORT_CARD_OPTIONS,
  MULTISPORT_NOT_ACCEPTED_LABEL,
  MULTISPORT_UNKNOWN_LABEL,
  acceptsMultisport,
  applyMultisport,
  comparePayable,
  courtPrice,
  courtPriceFrom,
  formatCardsUsed,
  formatCourtPrice,
  formatMultisport,
  formatMultisportLimits,
  isMultisportCards,
  validateMultisport,
} from './multisport.ts';
import type { MultisportInfo } from './multisport.ts';
import type { Pricing } from './pricing.ts';

// 2026-11-25 is a Wednesday, 2026-11-28 a Saturday.
const WED = '2026-11-25';
const SAT = '2026-11-28';

const PRICING: Pricing = {
  currency: 'CZK',
  unit: 'hour',
  rules: [
    { days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '07:00', to: '15:00', price: 280 },
    { days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '15:00', to: '22:00', price: 380 },
    { days: ['sat', 'sun'], from: '08:00', to: '22:00', price: 400 },
  ],
};

const HALF: MultisportInfo = { category: 'half-per-card' };
const FULL_TWO: MultisportInfo = {
  category: 'full-two-cards',
  limits: { maxCardsPerCourt: 2, onlyBookingMinutes: 60, requiresNotice: true },
};
const MIN30: MultisportInfo = { category: 'minutes-per-card', minutesPerCard: 30 };
const MIN20: MultisportInfo = { category: 'minutes-per-card', minutesPerCard: 20 };
const NO: MultisportInfo = { category: 'not-accepted' };
const UNKNOWN: MultisportInfo = { category: 'unknown' };

const at = (multisport: MultisportInfo | undefined, hour: number, cards: number, date = WED) =>
  courtPrice({ pricing: PRICING, multisport, date, hour, cards });

test('category labels', () => {
  assert.equal(formatMultisport(HALF), '1 card = 50 % off');
  assert.equal(formatMultisport(FULL_TWO), '2 cards = free');
  assert.equal(formatMultisport(MIN30), '1 card = 30 min');
  assert.equal(formatMultisport(NO), MULTISPORT_NOT_ACCEPTED_LABEL);
  assert.equal(formatMultisport(NO), 'No MultiSport');
  assert.equal(formatMultisport(UNKNOWN), MULTISPORT_UNKNOWN_LABEL);
  assert.equal(formatMultisport(undefined), 'MultiSport: unknown');
  assert.equal(acceptsMultisport(HALF), true);
  assert.equal(acceptsMultisport(MIN30), true);
  assert.equal(acceptsMultisport(NO), false);
  assert.equal(acceptsMultisport(UNKNOWN), false);
  assert.equal(acceptsMultisport(undefined), false);
});

test('limits as short phrases', () => {
  assert.deepEqual(formatMultisportLimits(FULL_TWO), [
    'max 2 cards per court',
    '60-min bookings only',
    'tell staff in advance',
  ]);
  assert.deepEqual(
    formatMultisportLimits({
      category: 'half-per-card',
      limits: { maxCardsPerCourt: 1, maxPlayersPerCourt: 4, minBookingMinutes: 90 },
      note: 'one activity per card per day',
    }),
    [
      'max 1 card per court',
      'max 4 players per court',
      'min. 90-min booking',
      'one activity per card per day',
    ],
  );
  assert.deepEqual(formatMultisportLimits(HALF), []);
  assert.deepEqual(formatMultisportLimits(UNKNOWN), []);
  assert.deepEqual(formatMultisportLimits(undefined), []);
  assert.deepEqual(formatMultisportLimits({ category: 'unknown', note: 'ask staff' }), [
    'ask staff',
  ]);
});

test('card options', () => {
  assert.deepEqual([...MULTISPORT_CARD_OPTIONS], [0, 1, 2, 3, 4]);
  assert.equal(isMultisportCards(2), true);
  assert.equal(isMultisportCards(5), false);
  assert.equal(isMultisportCards(1.5), false);
  assert.equal(isMultisportCards('2'), false);
});

test('courtPrice: unknown price → null', () => {
  assert.equal(
    courtPrice({ pricing: undefined, multisport: HALF, date: WED, hour: 10, cards: 1 }),
    null,
  );
  assert.equal(at(HALF, 6, 1), null, 'no rule before 07:00');
  assert.equal(at(HALF, 22, 1), null, 'no rule from 22:00');
  assert.equal(at(HALF, 7, 0, SAT), null, 'weekend starts at 08:00');
});

test('courtPrice: zero cards = base price', () => {
  assert.deepEqual(at(HALF, 10, 0), { basePrice: 280, cardsUsed: 0, payable: 280 });
});

test('courtPrice: tariff change at 15:00 (boundary hours)', () => {
  assert.deepEqual(at(HALF, 14, 1), { basePrice: 280, cardsUsed: 1, payable: 140 });
  assert.deepEqual(at(HALF, 15, 1), { basePrice: 380, cardsUsed: 1, payable: 190 });
  assert.deepEqual(at(HALF, 7, 0), { basePrice: 280, cardsUsed: 0, payable: 280 });
  assert.deepEqual(at(HALF, 21, 0), { basePrice: 380, cardsUsed: 0, payable: 380 });
  assert.deepEqual(at(HALF, 15, 0, SAT), { basePrice: 400, cardsUsed: 0, payable: 400 });
});

test('courtPrice: half-per-card – each card 50 %, at most 2 useful cards', () => {
  assert.deepEqual(at(HALF, 15, 1), { basePrice: 380, cardsUsed: 1, payable: 190 });
  assert.deepEqual(at(HALF, 15, 2), { basePrice: 380, cardsUsed: 2, payable: 0 });
  assert.deepEqual(at(HALF, 15, 4), { basePrice: 380, cardsUsed: 2, payable: 0 });
  const oneCard: MultisportInfo = { category: 'half-per-card', limits: { maxCardsPerCourt: 1 } };
  assert.deepEqual(at(oneCard, 15, 3), { basePrice: 380, cardsUsed: 1, payable: 190 });
});

test('courtPrice: full-two-cards – 1 card half, 2 cards free, capped at 2', () => {
  assert.deepEqual(at(FULL_TWO, 15, 1), { basePrice: 380, cardsUsed: 1, payable: 190 });
  assert.deepEqual(at(FULL_TWO, 15, 2), { basePrice: 380, cardsUsed: 2, payable: 0 });
  assert.deepEqual(at(FULL_TWO, 15, 3), { basePrice: 380, cardsUsed: 2, payable: 0 });
});

test('courtPrice: minutes-per-card', () => {
  assert.deepEqual(at(MIN30, 15, 1), { basePrice: 380, cardsUsed: 1, payable: 190 });
  assert.deepEqual(at(MIN30, 15, 2), { basePrice: 380, cardsUsed: 2, payable: 0 });
  assert.deepEqual(at(MIN30, 15, 4), { basePrice: 380, cardsUsed: 2, payable: 0 });
  assert.deepEqual(at(MIN20, 10, 1), { basePrice: 280, cardsUsed: 1, payable: 187 }, 'rounded');
  assert.deepEqual(at(MIN20, 10, 2), { basePrice: 280, cardsUsed: 2, payable: 93 });
  assert.deepEqual(at(MIN20, 10, 4), { basePrice: 280, cardsUsed: 3, payable: 0 });
});

test('courtPrice: maxPlayersPerCourt caps cards', () => {
  const players2: MultisportInfo = {
    category: 'minutes-per-card',
    minutesPerCard: 15,
    limits: { maxPlayersPerCourt: 2 },
  };
  assert.deepEqual(at(players2, 15, 4), { basePrice: 380, cardsUsed: 2, payable: 190 });
});

test('courtPrice: not-accepted / unknown → base price, no cards used', () => {
  for (const info of [NO, UNKNOWN, undefined]) {
    assert.deepEqual(at(info, 15, 2), { basePrice: 380, cardsUsed: 0, payable: 380 });
  }
});

test('applyMultisport: never negative, free court uses no cards, bad input = 0 cards', () => {
  assert.deepEqual(applyMultisport(0, HALF, 2), { basePrice: 0, cardsUsed: 0, payable: 0 });
  assert.deepEqual(applyMultisport(301, HALF, 1), { basePrice: 301, cardsUsed: 1, payable: 151 });
  assert.deepEqual(applyMultisport(300, HALF, -1), { basePrice: 300, cardsUsed: 0, payable: 300 });
  assert.deepEqual(applyMultisport(300, HALF, Number.NaN), {
    basePrice: 300,
    cardsUsed: 0,
    payable: 300,
  });
  assert.deepEqual(applyMultisport(300, HALF, 1.9), { basePrice: 300, cardsUsed: 1, payable: 150 });
});

test('courtPriceFrom: cheapest payable of the price list', () => {
  assert.deepEqual(courtPriceFrom(PRICING, HALF, 0), {
    basePrice: 280,
    cardsUsed: 0,
    payable: 280,
  });
  assert.deepEqual(courtPriceFrom(PRICING, HALF, 1), {
    basePrice: 280,
    cardsUsed: 1,
    payable: 140,
  });
  assert.deepEqual(courtPriceFrom(PRICING, HALF, 2), { basePrice: 280, cardsUsed: 2, payable: 0 });
  assert.deepEqual(courtPriceFrom(PRICING, NO, 2), { basePrice: 280, cardsUsed: 0, payable: 280 });
  assert.equal(courtPriceFrom(undefined, HALF, 1), null);
  assert.equal(courtPriceFrom({ ...PRICING, rules: [] }, HALF, 1), null);
});

test('comparePayable: cheaper first, unknown last', () => {
  const p = (payable: number) => ({ basePrice: 400, cardsUsed: 0, payable });
  assert.ok(comparePayable(p(100), p(200)) < 0);
  assert.ok(comparePayable(p(200), p(100)) > 0);
  assert.equal(comparePayable(p(100), p(100)), 0);
  assert.ok(comparePayable(null, p(100)) > 0);
  assert.ok(comparePayable(p(100), null) < 0);
  assert.equal(comparePayable(null, null), 0);
  const sorted = [p(300), null, p(0), p(150)].sort(comparePayable).map((x) => x?.payable ?? null);
  assert.deepEqual(sorted, [0, 150, 300, null]);
});

test('formatCourtPrice and formatCardsUsed', () => {
  assert.equal(formatCourtPrice(null), 'Price on website');
  assert.equal(formatCourtPrice({ basePrice: 400, cardsUsed: 0, payable: 400 }), '400 Kč / h');
  assert.equal(formatCourtPrice({ basePrice: 400, cardsUsed: 1, payable: 200 }), '400 Kč → 200 Kč');
  assert.equal(formatCourtPrice({ basePrice: 400, cardsUsed: 2, payable: 0 }), '400 Kč → 0 Kč');
  assert.equal(formatCardsUsed(0), '');
  assert.equal(formatCardsUsed(1), 'with 1 card');
  assert.equal(formatCardsUsed(2), 'with 2 cards');
});

test('validateMultisport', () => {
  for (const info of [HALF, FULL_TWO, MIN30, NO, UNKNOWN])
    assert.deepEqual(validateMultisport(info), []);
  assert.deepEqual(validateMultisport({ category: 'minutes-per-card', minutesPerCard: 0 }), [
    'minutesPerCard must be an integer 1–60',
  ]);
  assert.deepEqual(validateMultisport({ category: 'minutes-per-card', minutesPerCard: 90 }), [
    'minutesPerCard must be an integer 1–60',
  ]);
  assert.deepEqual(
    validateMultisport({
      category: 'half-per-card',
      limits: {
        maxCardsPerCourt: 0,
        maxPlayersPerCourt: 2.5,
        minBookingMinutes: 60,
        onlyBookingMinutes: 60,
      },
    }),
    [
      'maxCardsPerCourt must be a positive integer',
      'maxPlayersPerCourt must be a positive integer',
      'use either minBookingMinutes or onlyBookingMinutes',
    ],
  );
  assert.deepEqual(validateMultisport({ category: 'unknown', note: ' ' }), ['empty note']);
  assert.deepEqual(validateMultisport({ category: 'percentOff' } as unknown as MultisportInfo), [
    'unknown category',
  ]);
});
