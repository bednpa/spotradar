import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MULTISPORT_NOT_ACCEPTED_LABEL,
  MULTISPORT_UNKNOWN_LABEL,
  PRICE_UNKNOWN_LABEL,
  formatDays,
  formatHourlyPrice,
  formatMultisport,
  formatMultisportPrice,
  formatPriceFrom,
  formatPriceRule,
  minPrice,
  priceFor,
  priceRuleFor,
  priceWithMultisport,
  validatePricing,
} from './pricing.ts';
import type { Pricing } from './pricing.ts';

// 2026-11-25 is a Wednesday, 2026-11-28 a Saturday, 2026-11-29 a Sunday.
const WED = '2026-11-25';
const SAT = '2026-11-28';
const SUN = '2026-11-29';

const PRICING: Pricing = {
  currency: 'CZK',
  unit: 'hour',
  rules: [
    { days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '07:00', to: '15:00', price: 280 },
    { days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '15:00', to: '22:00', price: 380 },
    { days: ['sat', 'sun'], from: '08:00', to: '21:00', price: 380 },
  ],
};

test('priceFor: weekday rules with the 15:00 boundary', () => {
  assert.equal(priceFor(PRICING, WED, 7), 280);
  assert.equal(priceFor(PRICING, WED, 14), 280);
  assert.equal(priceFor(PRICING, WED, '14:30'), 280);
  assert.equal(priceFor(PRICING, WED, 15), 380, '15:00 belongs to the later rule');
  assert.equal(priceFor(PRICING, WED, '15:00'), 380);
  assert.equal(priceFor(PRICING, WED, 21), 380);
});

test('priceFor: weekends', () => {
  assert.equal(priceFor(PRICING, SAT, 8), 380);
  assert.equal(priceFor(PRICING, SUN, 10), 380);
  assert.equal(priceFor(PRICING, SAT, 7), null, 'before the weekend rule');
});

test('priceFor: outside every rule or without pricing → null', () => {
  assert.equal(priceFor(PRICING, WED, 6), null);
  assert.equal(priceFor(PRICING, WED, 22), null, 'to is exclusive');
  assert.equal(priceFor(undefined, WED, 10), null);
  assert.equal(priceRuleFor(PRICING, WED, 10)?.from, '07:00');
});

test('minPrice and short labels', () => {
  assert.equal(minPrice(PRICING), 280);
  assert.equal(minPrice(undefined), null);
  assert.equal(minPrice({ ...PRICING, rules: [] }), null);
  assert.equal(formatHourlyPrice(380), '380 Kč / h');
  assert.equal(formatHourlyPrice(null), PRICE_UNKNOWN_LABEL);
  assert.equal(formatPriceFrom(PRICING), 'from 280 Kč / h');
  assert.equal(formatPriceFrom(undefined), 'Price on website');
});

test('formatDays and formatPriceRule', () => {
  assert.equal(formatDays(['mon', 'tue', 'wed', 'thu', 'fri']), 'Mon–Fri');
  assert.equal(formatDays(['sun', 'sat']), 'Sat, Sun');
  assert.equal(formatDays(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']), 'Mon–Sun');
  assert.equal(formatDays(['mon', 'wed', 'fri']), 'Mon, Wed, Fri');
  assert.equal(formatDays(['mon', 'tue', 'wed', 'sat', 'sun']), 'Mon–Wed, Sat, Sun');
  assert.equal(formatPriceRule(PRICING.rules[0]!), 'Mon–Fri 07:00–15:00: 280 Kč / h');
});

test('validatePricing accepts a valid list and reports problems', () => {
  assert.deepEqual(validatePricing(PRICING), []);
  assert.deepEqual(validatePricing({ ...PRICING, rules: [] }), ['no rules']);
  const bad: Pricing = {
    currency: 'CZK',
    unit: 'hour',
    rules: [
      { days: [], from: '10:00', to: '09:00', price: -1 },
      { days: ['mon'], from: '7:00', to: '24:00', price: 100 },
    ],
  };
  const issues = validatePricing(bad);
  assert.ok(issues.includes('rule 0: no days'));
  assert.ok(issues.includes('rule 0: from ≥ to'));
  assert.ok(issues.includes('rule 0: invalid price'));
  assert.ok(issues.includes('rule 1: invalid time'));
  const overlap: Pricing = {
    ...PRICING,
    rules: [
      { days: ['mon', 'tue'], from: '07:00', to: '16:00', price: 1 },
      { days: ['tue'], from: '15:00', to: '22:00', price: 2 },
    ],
  };
  assert.deepEqual(validatePricing(overlap), ['rules 0 and 1 overlap']);
  assert.deepEqual(
    validatePricing({ ...PRICING, rules: [{ ...PRICING.rules[0]!, to: '24:00' }] }),
    [],
  );
});

test('formatMultisport gives one short label', () => {
  assert.equal(formatMultisport(undefined), MULTISPORT_UNKNOWN_LABEL);
  assert.equal(formatMultisport(undefined), 'MultiSport: unknown');
  assert.equal(formatMultisport({ accepted: false }), MULTISPORT_NOT_ACCEPTED_LABEL);
  assert.equal(formatMultisport({ accepted: false }), 'No MultiSport');
  assert.equal(formatMultisport({ accepted: true }), 'MultiSport accepted');
  assert.equal(
    formatMultisport({ accepted: true, coverage: { kind: 'percentOff', percent: 50 } }),
    'MultiSport · 50 % off',
  );
  assert.equal(
    formatMultisport({ accepted: true, coverage: { kind: 'minutesPerCard', minutes: 30 } }),
    'MultiSport · 30 min / card',
  );
  assert.equal(
    formatMultisport({ accepted: true, coverage: { kind: 'fixedDiscount', amountCzk: 100 } }),
    'MultiSport · −100 Kč',
  );
});

test('price with MultiSport where computable', () => {
  const half = { accepted: true, coverage: { kind: 'percentOff', percent: 50 } } as const;
  const fixed = { accepted: true, coverage: { kind: 'fixedDiscount', amountCzk: 150 } } as const;
  const minutes = { accepted: true, coverage: { kind: 'minutesPerCard', minutes: 30 } } as const;
  assert.equal(priceWithMultisport(380, half), 190);
  assert.equal(priceWithMultisport(285, half), 143, 'rounded');
  assert.equal(priceWithMultisport(380, fixed), 230);
  assert.equal(priceWithMultisport(100, fixed), 0, 'never negative');
  assert.equal(priceWithMultisport(380, minutes), null);
  assert.equal(priceWithMultisport(380, { accepted: true }), null);
  assert.equal(priceWithMultisport(380, { accepted: false }), null);
  assert.equal(priceWithMultisport(380, undefined), null);
  assert.equal(priceWithMultisport(null, half), null);
  assert.equal(formatMultisportPrice(380, half), '380 Kč → 190 Kč with MultiSport');
  assert.equal(formatMultisportPrice(380, minutes), null);
  assert.equal(formatMultisportPrice(null, half), null);
});
