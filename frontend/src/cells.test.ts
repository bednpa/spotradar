import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cellAriaLabel,
  computeCell,
  hourStatuses,
  indexDays,
  isCellSelectable,
  summarizeDay,
  venueCoverage,
} from './cells.ts';
import { NOW, makeCalendar } from './test-fixtures.test.ts';

const data = makeCalendar('2026-11-25', '2026-12-09');
const days = indexDays(data);
const opts = { now: NOW };

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

test('venues without live data never make a cell free: the cell is plain "nothing free"', () => {
  // 12:00: only the venues without live data are open.
  const cell = computeCell(days, data.venues, '2026-11-26', 12, opts);
  assert.equal(cell.kind, 'none');
  assert.equal(cell.summary.freeVenues, 0);
  assert.equal(isCellSelectable(cell), true); // still opens the panel with the "check on website" list
  assert.equal(cellAriaLabel(cell), 'Thursday 26 November, 12:00–13:00: nothing free');
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

test('summarizeDay counts free hours (06–23) and the best hour', () => {
  assert.deepEqual(summarizeDay(days, data.venues, '2026-11-26', opts), {
    freeHours: 3,
    bestHour: 8,
  });
  assert.deepEqual(summarizeDay(days, data.venues, '2030-01-01', opts), {
    freeHours: 0,
    bestHour: null,
  });
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
