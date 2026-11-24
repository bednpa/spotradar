import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  getBookingWindow,
  isDateInBookingWindow,
  isValidDate,
  isValidSlotTime,
  isValidTime,
  minutesToTime,
  timeToMinutes,
  toLocalDateTime,
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

test('isValidTime / isValidSlotTime', () => {
  assert.equal(isValidTime('00:00'), true);
  assert.equal(isValidTime('23:59'), true);
  assert.equal(isValidTime('24:00'), false);
  assert.equal(isValidTime('9:00'), false);
  assert.equal(isValidSlotTime('18:00'), true);
  assert.equal(isValidSlotTime('18:30'), true);
  assert.equal(isValidSlotTime('18:15'), false);
  assert.equal(isValidSlotTime('abc'), false);
});

test('timeToMinutes and minutesToTime are inverse', () => {
  assert.equal(timeToMinutes('07:30'), 450);
  assert.equal(minutesToTime(450), '07:30');
  assert.equal(minutesToTime(0), '00:00');
  assert.equal(minutesToTime(22 * 60), '22:00');
});

test('addDays crosses month and year boundaries', () => {
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
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

test('booking window spans 14 days starting today', () => {
  const now = new Date('2026-11-24T10:00:00Z');
  assert.deepEqual(getBookingWindow(now), { from: '2026-11-24', to: '2026-12-07' });
  assert.equal(isDateInBookingWindow('2026-11-24', now), true);
  assert.equal(isDateInBookingWindow('2026-12-07', now), true);
  assert.equal(isDateInBookingWindow('2026-12-08', now), false);
  assert.equal(isDateInBookingWindow('2026-11-23', now), false);
});
