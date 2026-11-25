import { test } from 'node:test';
import assert from 'node:assert/strict';
import { courtPrice } from '@spotradar/shared';
import type { MultisportInfo, Pricing } from '@spotradar/shared';
import { parseCards, parseSort, renderListControls, sortEntries } from './sorting.ts';
import type { SortKey } from './sorting.ts';

function pricing(price: number): Pricing {
  return {
    currency: 'CZK',
    unit: 'hour',
    rules: [
      {
        days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
        from: '00:00',
        to: '24:00',
        price,
      },
    ],
  };
}

interface Row {
  name: string;
  km?: number;
  base?: number;
  ms?: MultisportInfo;
}

const HALF: MultisportInfo = { category: 'half-per-card' };

function keyFor(cards: number): (row: Row) => SortKey {
  return (row) => ({
    name: row.name,
    ...(row.km !== undefined ? { distanceKm: row.km } : {}),
    price:
      row.base === undefined
        ? null
        : courtPrice({
            pricing: pricing(row.base),
            multisport: row.ms ?? HALF,
            date: '2026-11-25',
            hour: 18,
            cards,
          }),
  });
}

const names = (rows: Row[]): string[] => rows.map((r) => r.name);

test('parseSort / parseCards fall back to the defaults', () => {
  assert.equal(parseSort('price'), 'price');
  assert.equal(parseSort('distance'), 'distance');
  assert.equal(parseSort('cheap'), 'distance');
  assert.equal(parseSort(null), 'distance');
  assert.equal(parseCards('0'), 0);
  assert.equal(parseCards('4'), 4);
  assert.equal(parseCards('5'), 0);
  assert.equal(parseCards('-1'), 0);
  assert.equal(parseCards('1.5'), 0);
  assert.equal(parseCards(' 2'), 0);
  assert.equal(parseCards(null), 0);
});

test('distance: nearest first, ties by Czech name, unknown distance last', () => {
  const rows: Row[] = [
    { name: 'Zeta', km: 3 },
    { name: 'Čepice', km: 1 },
    { name: 'Alfa', km: 1 },
    { name: 'Nowhere' },
    { name: 'Dálka', km: 0.5 },
  ];
  assert.deepEqual(names(sortEntries(rows, 'distance', keyFor(0))), [
    'Dálka',
    'Alfa',
    'Čepice',
    'Zeta',
    'Nowhere',
  ]);
  // the input is not mutated
  assert.equal(rows[0]?.name, 'Zeta');
});

test('distance without any location keeps the incoming order', () => {
  const rows: Row[] = [{ name: 'Zeta' }, { name: 'Alfa' }, { name: 'Mid' }];
  assert.deepEqual(names(sortEntries(rows, 'distance', keyFor(0))), ['Zeta', 'Alfa', 'Mid']);
});

test('price: cheapest payable first, ties by distance then name, unknown price last', () => {
  const rows: Row[] = [
    { name: 'Unknown price', km: 0.1 },
    { name: 'Dear', km: 1, base: 500 },
    { name: 'Far cheap', km: 9, base: 200 },
    { name: 'Near cheap', km: 2, base: 200 },
    { name: 'Same b', base: 200 },
    { name: 'Same a', base: 200 },
    { name: 'Tie name b', km: 2, base: 200 },
  ];
  assert.deepEqual(names(sortEntries(rows, 'price', keyFor(0))), [
    'Near cheap',
    'Tie name b',
    'Far cheap',
    'Same a',
    'Same b',
    'Dear',
    'Unknown price',
  ]);
});

test('price order is recomputed when the cards change', () => {
  // A: 400 Kč with MultiSport (2 cards -> 0), B: 300 Kč without MultiSport
  const rows: Row[] = [
    { name: 'A', km: 1, base: 400 },
    { name: 'B', km: 2, base: 300, ms: { category: 'not-accepted' } },
  ];
  assert.deepEqual(names(sortEntries(rows, 'price', keyFor(0))), ['B', 'A']);
  // one card: A pays 200
  assert.deepEqual(names(sortEntries(rows, 'price', keyFor(1))), ['A', 'B']);
  assert.deepEqual(names(sortEntries(rows, 'price', keyFor(2))), ['A', 'B']);
});

test('the controls are two labelled segmented groups with aria-pressed buttons', () => {
  const html = renderListControls('price', 2, 'panel');
  assert.match(html, /<span class="label" id="panel-sort-label">Sort by<\/span>/);
  assert.match(html, /role="group" aria-labelledby="panel-sort-label"/);
  assert.match(html, /data-sort-mode="distance"[^>]*aria-pressed="false">Distance<\/button>/);
  assert.match(html, /data-sort-mode="price"[^>]*aria-pressed="true">Price<\/button>/);
  assert.match(html, /id="panel-cards-label">MultiSport cards</);
  assert.equal((html.match(/data-cards-count="/g) ?? []).length, 5);
  assert.match(html, /data-cards-count="2"[^>]*aria-pressed="true">2<\/button>/);
  assert.equal((html.match(/data-cards-count="\d"[^>]*aria-pressed="true"/g) ?? []).length, 1);
});

test('renderListControls: one row of two groups, the cards group marked for the flexible width', () => {
  const html = renderListControls('distance', 0, 'venues');
  assert.equal((html.match(/class="list-control[ "]/g) ?? []).length, 2);
  assert.match(html, /class="list-control list-control-cards"><span class="label" id="venues-cards-label">/);
});
