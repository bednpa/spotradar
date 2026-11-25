import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cellAriaLabel,
  computeCell,
  findNextFree,
  hourStatuses,
  indexDays,
  isCellSelectable,
  summarizeDay,
  venueCoverage,
} from './cells.ts';
import { NOW, makeCalendar } from './test-fixtures.test.ts';

const data = makeCalendar('2026-11-25', '2026-12-09');
const days = indexDays(data);
const opts = { now: NOW, onlyFree: false };

test('past hours and dates outside the window are not selectable', () => {
  const past = computeCell(days, data.venues, '2026-11-25', 8, opts);
  assert.equal(past.kind, 'past');
  assert.equal(isCellSelectable(past), false);
  // now is 12:00, so the 11:00 hour has ended but 12:00 is current.
  assert.equal(computeCell(days, data.venues, '2026-11-25', 11, opts).kind, 'past');
  assert.notEqual(computeCell(days, data.venues, '2026-11-25', 12, opts).kind, 'past');
  assert.equal(computeCell(days, data.venues, '2026-11-24', 12, opts).kind, 'past');
  assert.equal(computeCell(days, data.venues, '2026-12-10', 12, opts).kind, 'outside');
  assert.equal(
    cellAriaLabel(computeCell(days, data.venues, '2026-12-10', 12, opts)),
    'Thursday 10 December, 12:00–13:00: not available yet',
  );
});

test('free cell counts venues and courts and has an aria label', () => {
  const cell = computeCell(days, data.venues, '2026-11-26', 8, opts);
  assert.equal(cell.kind, 'free');
  assert.deepEqual(cell.summary, { freeVenues: 1, checkVenues: 2, freeCourts: 3 });
  assert.equal(cell.level, 1);
  assert.equal(isCellSelectable(cell), true);
  assert.equal(cellAriaLabel(cell), 'Thursday 26 November, 08:00–09:00: 1 venue free');
});

test('check cell: only venues without live data are open', () => {
  const cell = computeCell(days, data.venues, '2026-11-26', 12, opts);
  assert.equal(cell.kind, 'check');
  assert.equal(
    cellAriaLabel(cell),
    'Thursday 26 November, 12:00–13:00: no live data, 2 venues to check on website',
  );
  assert.equal(
    computeCell(days, data.venues, '2026-11-26', 12, { now: NOW, onlyFree: true }).kind,
    'none',
  );
});

test('none cell when every venue is closed', () => {
  const cell = computeCell(days, data.venues, '2026-11-26', 6, opts);
  assert.equal(cell.kind, 'none');
  assert.equal(cellAriaLabel(cell), 'Thursday 26 November, 06:00–07:00: nothing free');
});

test('hourStatuses are sorted free, check, full, closed', () => {
  const statuses = hourStatuses(days, data.venues, '2026-11-26', 18);
  assert.deepEqual(
    statuses.map((s) => `${s.venueId}:${s.state}`),
    ['kuklenska:free', 'viktoria:check', 'unknown:check', 'full:full', 'closed:closed'],
  );
  assert.deepEqual(hourStatuses(days, data.venues, '2030-01-01', 18), []);
});

test('findNextFree finds the earliest upcoming free hour', () => {
  assert.deepEqual(findNextFree(data, NOW, 6, 23), {
    date: '2026-11-25',
    hour: 18,
    summary: { freeVenues: 1, checkVenues: 2, freeCourts: 1 },
  });
  // Hour filter excludes 18:00 today, so the next one is tomorrow at 08:00.
  const filtered = findNextFree(data, NOW, 6, 17);
  assert.equal(filtered?.date, '2026-11-26');
  assert.equal(filtered?.hour, 8);
  assert.equal(findNextFree({ ...data, days: [] }, NOW, 6, 23), null);
});

test('summarizeDay counts free and check hours and the best hour', () => {
  const summary = summarizeDay(days, data.venues, '2026-11-26', 6, 23, opts);
  assert.deepEqual(summary, { freeHours: 3, checkHours: 12, bestHour: 8 });
  const onlyFree = summarizeDay(days, data.venues, '2026-11-26', 6, 23, {
    now: NOW,
    onlyFree: true,
  });
  assert.equal(onlyFree.checkHours, 0);
});

test('venueCoverage distinguishes live, unavailable and unknown', () => {
  const coverage = venueCoverage(data).map((c) => `${c.venue.venue.id}:${c.coverage}`);
  assert.deepEqual(coverage, [
    'kuklenska:live',
    'viktoria:unavailable',
    'unknown:unknown',
    'full:live',
    'closed:unknown',
  ]);
});
