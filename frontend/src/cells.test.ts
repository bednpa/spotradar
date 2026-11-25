import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cellAriaLabel,
  computeCell,
  hourStatuses,
  indexDays,
  isCellSelectable,
  slotHourRange,
  summarizeDay,
  venueCoverage,
} from './cells.ts';
import { NOW, hours, live, makeCalendar, makeVenue } from './test-fixtures.test.ts';

test('slotHourRange: Day starts at the first hour with a slot and ends after the last', () => {
  const calendar = makeCalendar('2026-11-25', '2026-11-27', [
    { venue: makeVenue('viktoria', 'Afternoon Hall', { openingHours: hours('14:00', '18:00') }) },
  ]);
  const idx = indexDays(calendar);
  assert.deepEqual(slotHourRange(idx, calendar.venues, ['2026-11-26']), {
    fromHour: 14,
    toHour: 18,
  });
});

test('slotHourRange: Week uses one shared range and keeps empty hours in between', () => {
  const calendar = makeCalendar('2026-11-23', '2026-11-29', [
    { venue: makeVenue('viktoria', 'Early Hall', { openingHours: hours('07:00', '09:00') }) },
    { venue: makeVenue('unknown', 'Late Hall', { openingHours: hours('20:00', '22:00') }) },
  ]);
  const idx = indexDays(calendar);
  const week = ['2026-11-26', '2026-11-27'];
  assert.deepEqual(slotHourRange(idx, calendar.venues, week), { fromHour: 7, toHour: 22 });
  // A single day of the same data has the same range (both venues open every day).
  assert.deepEqual(slotHourRange(idx, calendar.venues, ['2026-11-26']), {
    fromHour: 7,
    toHour: 22,
  });
});

test('slotHourRange: a week is widened by the day with the earliest / latest slot', () => {
  const base = makeCalendar('2026-11-25', '2026-11-27', [
    {
      venue: makeVenue('viktoria', 'Weekend Hall', {
        openingHours: {
          approximate: false,
          days: {
            ...hours(null).days,
            thu: { open: '10:00', close: '12:00' },
            fri: { open: '16:00', close: '18:00' },
          },
        },
      }),
    },
  ]);
  const idx = indexDays(base);
  assert.deepEqual(slotHourRange(idx, base.venues, ['2026-11-26']), { fromHour: 10, toHour: 12 });
  assert.deepEqual(slotHourRange(idx, base.venues, ['2026-11-27']), { fromHour: 16, toHour: 18 });
  assert.deepEqual(slotHourRange(idx, base.venues, ['2026-11-26', '2026-11-27']), {
    fromHour: 10,
    toHour: 18,
  });
});

test('slotHourRange: free slots of a live venue count, full hours do not', () => {
  const calendar = makeCalendar('2026-11-25', '2026-11-27', [
    { venue: makeVenue('kuklenska', 'Live Hall') },
  ]);
  calendar.days = calendar.days.map((day) => ({
    ...day,
    venues: [
      {
        venueId: 'kuklenska',
        availability: live([{ start: '10:00', end: '12:00', freeCourts: 2 }]),
      },
    ],
  }));
  assert.deepEqual(slotHourRange(indexDays(calendar), calendar.venues, ['2026-11-26']), {
    fromHour: 10,
    toHour: 12,
  });
});

test('slotHourRange: null without data, when all venues are closed or fully booked', () => {
  const calendar = makeCalendar('2026-11-25', '2026-11-27');
  const idx = indexDays(calendar);
  assert.equal(slotHourRange(idx, calendar.venues, ['2026-12-20']), null);
  assert.equal(slotHourRange(idx, calendar.venues, []), null);
  const closed = makeCalendar('2026-11-25', '2026-11-27', [
    { venue: makeVenue('closed', 'Closed Hall', { openingHours: hours(null) }) },
  ]);
  assert.equal(slotHourRange(indexDays(closed), closed.venues, ['2026-11-26']), null);
  const full = makeCalendar('2026-11-25', '2026-11-27', [
    { venue: makeVenue('full', 'Full Hall') },
  ]);
  assert.equal(slotHourRange(indexDays(full), full.venues, ['2026-11-26']), null);
  assert.equal(slotHourRange(indexDays(null), [], ['2026-11-26']), null);
});

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
