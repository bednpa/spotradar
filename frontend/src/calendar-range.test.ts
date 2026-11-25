import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  anchorFor,
  clampRange,
  firstDayRange,
  monthGrid,
  nextPeriodRange,
  periodTitle,
  requestRange,
  shiftDate,
  visibleHours,
  visibleRange,
  weekDates,
  weekStart,
  yearMonths,
} from './calendar-range.ts';

const WINDOW = { from: '2026-11-25', to: '2026-12-09' };

test('week starts on Monday', () => {
  assert.equal(weekStart('2026-11-25'), '2026-11-23'); // Wednesday
  assert.equal(weekStart('2026-11-23'), '2026-11-23'); // Monday
  assert.equal(weekStart('2026-11-29'), '2026-11-23'); // Sunday
  assert.deepEqual(weekDates('2026-11-25'), [
    '2026-11-23',
    '2026-11-24',
    '2026-11-25',
    '2026-11-26',
    '2026-11-27',
    '2026-11-28',
    '2026-11-29',
  ]);
});

test('month grid covers whole weeks Monday-first', () => {
  const grid = monthGrid('2026-11-25');
  assert.equal(grid.length, 6);
  assert.equal(grid[0]?.[0], '2026-10-26');
  assert.equal(grid[0]?.[6], '2026-11-01');
  assert.equal(grid[5]?.[0], '2026-11-30');
  assert.equal(grid[5]?.[6], '2026-12-06');
  assert.ok(grid.every((week) => week.length === 7));
  // February 2026 starts on Sunday-less boundary: exactly 4 weeks.
  assert.equal(monthGrid('2027-02-10').length, 4);
});

test('year has twelve month starts', () => {
  const months = yearMonths('2026-11-25');
  assert.equal(months.length, 12);
  assert.equal(months[0], '2026-01-01');
  assert.equal(months[11], '2026-12-01');
});

test('clampRange intersects with the window', () => {
  assert.deepEqual(clampRange({ from: '2026-11-23', to: '2026-11-29' }, WINDOW), {
    from: '2026-11-25',
    to: '2026-11-29',
  });
  assert.deepEqual(clampRange({ from: '2026-12-07', to: '2026-12-13' }, WINDOW), {
    from: '2026-12-07',
    to: '2026-12-09',
  });
  assert.equal(clampRange({ from: '2026-12-10', to: '2026-12-16' }, WINDOW), null);
  assert.equal(clampRange({ from: '2026-11-01', to: '2026-11-24' }, WINDOW), null);
});

test('requestRange: day/week clamp, month/year use the whole window', () => {
  assert.deepEqual(requestRange('day', '2026-11-27', WINDOW), {
    from: '2026-11-27',
    to: '2026-11-27',
  });
  assert.equal(requestRange('day', '2026-11-24', WINDOW), null);
  assert.deepEqual(requestRange('week', '2026-11-25', WINDOW), {
    from: '2026-11-25',
    to: '2026-11-29',
  });
  assert.deepEqual(requestRange('week', '2026-12-09', WINDOW), {
    from: '2026-12-07',
    to: '2026-12-09',
  });
  assert.deepEqual(requestRange('month', '2027-03-01', WINDOW), WINDOW);
  assert.deepEqual(requestRange('year', '2026-11-25', WINDOW), WINDOW);
});

test('visibleRange per view', () => {
  assert.deepEqual(visibleRange('month', '2026-11-25'), { from: '2026-11-01', to: '2026-11-30' });
  assert.deepEqual(visibleRange('year', '2026-11-25'), { from: '2026-01-01', to: '2026-12-31' });
  assert.deepEqual(visibleRange('week', '2026-11-25'), { from: '2026-11-23', to: '2026-11-29' });
});

test('shiftDate moves by the view unit and snaps to today inside the period', () => {
  const today = '2026-11-25';
  assert.equal(shiftDate('day', '2026-11-25', 1, today), '2026-11-26');
  assert.equal(shiftDate('day', '2026-11-25', -1, today), '2026-11-24');
  assert.equal(shiftDate('week', '2026-11-25', 1, today), '2026-12-02');
  assert.equal(shiftDate('month', '2026-11-25', 1, today), '2026-12-01');
  assert.equal(shiftDate('month', '2026-12-01', -1, today), today);
  assert.equal(shiftDate('month', '2026-01-15', -1, today), '2025-12-01');
  assert.equal(shiftDate('year', '2026-11-25', 1, today), '2027-01-01');
  assert.equal(shiftDate('year', '2027-01-01', -1, today), today);
  assert.equal(anchorFor('2026-12-01', 'month', today), '2026-12-01');
});

test('period titles', () => {
  assert.equal(periodTitle('day', '2026-11-25'), 'Wednesday 25 November 2026');
  assert.equal(periodTitle('week', '2026-11-25'), '23–29 November 2026');
  assert.equal(periodTitle('week', '2026-12-02'), '30 Nov – 6 Dec 2026');
  assert.equal(periodTitle('week', '2026-12-31'), '28 Dec 2026 – 3 Jan 2027');
  assert.equal(periodTitle('month', '2026-11-25'), 'November 2026');
  assert.equal(periodTitle('year', '2026-11-25'), '2026');
});

test('visibleHours', () => {
  assert.deepEqual(visibleHours(6, 9), [6, 7, 8]);
  assert.deepEqual(visibleHours(9, 9), []);
  assert.deepEqual(visibleHours(10, 9), []);
});

test('firstDayRange: the focused day of a multi-day range, clamped; null for a single day', () => {
  const week = { from: '2026-11-25', to: '2026-11-29' };
  assert.deepEqual(firstDayRange(week, '2026-11-27', WINDOW), {
    from: '2026-11-27',
    to: '2026-11-27',
  });
  // focus before / after the range is clamped into it
  assert.deepEqual(firstDayRange(week, '2026-11-23', WINDOW), {
    from: '2026-11-25',
    to: '2026-11-25',
  });
  assert.deepEqual(firstDayRange(week, '2026-12-03', WINDOW), {
    from: '2026-11-29',
    to: '2026-11-29',
  });
  // month/year ranges (the whole window) with the focus outside the window
  assert.deepEqual(firstDayRange(WINDOW, '2026-12-20', WINDOW), {
    from: '2026-12-09',
    to: '2026-12-09',
  });
  assert.equal(firstDayRange({ from: '2026-11-25', to: '2026-11-25' }, '2026-11-25', WINDOW), null);
});

test('nextPeriodRange: next week / next 7 days, clamped to the window, none for month/year', () => {
  assert.deepEqual(nextPeriodRange('week', '2026-11-25', WINDOW), {
    from: '2026-11-30',
    to: '2026-12-06',
  });
  // the last week is cut at the end of the window
  assert.deepEqual(nextPeriodRange('week', '2026-12-02', WINDOW), {
    from: '2026-12-07',
    to: '2026-12-09',
  });
  assert.equal(nextPeriodRange('week', '2026-12-09', WINDOW), null);
  assert.deepEqual(nextPeriodRange('day', '2026-11-25', WINDOW), {
    from: '2026-11-26',
    to: '2026-12-02',
  });
  assert.deepEqual(nextPeriodRange('day', '2026-12-07', WINDOW), {
    from: '2026-12-08',
    to: '2026-12-09',
  });
  assert.equal(nextPeriodRange('day', '2026-12-09', WINDOW), null);
  assert.equal(nextPeriodRange('month', '2026-11-25', WINDOW), null);
  assert.equal(nextPeriodRange('year', '2026-11-25', WINDOW), null);
});
