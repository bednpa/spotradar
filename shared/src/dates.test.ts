import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  getSearchWindow,
  isDateInSearchWindow,
  isValidDate,
  isValidTime,
  minutesToTime,
  timeToMinutes,
  toLocalDateTime,
  weekdayOf,
  zonedMidnightEpochMs,
} from './dates.ts';

test('isValidDate accepts real dates and rejects invalid ones', () => {
  assert.equal(isValidDate('2026-11-24'), true);
  assert.equal(isValidDate('2028-02-29'), true);
  assert.equal(isValidDate('2026-02-29'), false);
  assert.equal(isValidDate('2026-13-01'), false);
  assert.equal(isValidDate('2026-1-01'), false);
  assert.equal(isValidDate('tomorrow'), false);
  assert.equal(isValidDate(''), false);
});

test('isValidTime accepts any HH:MM minute', () => {
  assert.equal(isValidTime('00:00'), true);
  assert.equal(isValidTime('23:59'), true);
  assert.equal(isValidTime('18:15'), true);
  assert.equal(isValidTime('24:00'), false);
  assert.equal(isValidTime('9:00'), false);
  assert.equal(isValidTime('abc'), false);
});

test('timeToMinutes and minutesToTime are inverse', () => {
  assert.equal(timeToMinutes('07:30'), 450);
  assert.equal(minutesToTime(450), '07:30');
  assert.equal(minutesToTime(0), '00:00');
  assert.equal(minutesToTime(1440), '24:00');
  assert.equal(timeToMinutes('24:00'), 1440);
});

test('addDays crosses month and year boundaries', () => {
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('weekdayOf returns Monday-based weekday ids', () => {
  assert.equal(weekdayOf('2026-11-23'), 'mon');
  assert.equal(weekdayOf('2026-11-24'), 'tue');
  assert.equal(weekdayOf('2026-11-29'), 'sun');
  assert.equal(weekdayOf('2026-11-28'), 'sat');
});

test('toLocalDateTime uses Europe/Prague wall-clock time', () => {
  // 23:30 UTC in winter is 00:30 next day in Prague (UTC+1)
  assert.deepEqual(toLocalDateTime(new Date('2026-11-24T23:30:00Z')), {
    date: '2026-11-25',
    minutes: 30,
  });
  // Summer time (UTC+2)
  assert.deepEqual(toLocalDateTime(new Date('2026-07-01T10:00:00Z')), {
    date: '2026-07-01',
    minutes: 12 * 60,
  });
});

test('zonedMidnightEpochMs returns local midnight in Europe/Prague (winter, summer, DST days)', () => {
  assert.equal(zonedMidnightEpochMs('2026-11-25'), Date.parse('2026-11-24T23:00:00Z'));
  assert.equal(zonedMidnightEpochMs('2026-11-25'), 1795561200000);
  assert.equal(zonedMidnightEpochMs('2026-07-01'), Date.parse('2026-06-30T22:00:00Z'));
  // DST starts 2026-03-29 at 02:00 – midnight is still UTC+1
  assert.equal(zonedMidnightEpochMs('2026-03-29'), Date.parse('2026-03-28T23:00:00Z'));
  // DST ends 2026-10-25 at 03:00 – midnight is still UTC+2
  assert.equal(zonedMidnightEpochMs('2026-10-25'), Date.parse('2026-10-24T22:00:00Z'));
});

test('search window spans today … today + 14 days', () => {
  const now = new Date('2026-11-24T10:00:00Z');
  assert.deepEqual(getSearchWindow(now), { from: '2026-11-24', to: '2026-12-08' });
  assert.equal(isDateInSearchWindow('2026-11-24', now), true);
  assert.equal(isDateInSearchWindow('2026-12-08', now), true);
  assert.equal(isDateInSearchWindow('2026-12-09', now), false);
  assert.equal(isDateInSearchWindow('2026-11-23', now), false);
});
