import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatCheckedAgo,
  formatCourts,
  formatDateLabel,
  formatClockTime,
  formatDistance,
  formatLongDate,
  formatShortDate,
  formatShortWeekday,
  formatSlotRange,
  formatVenues,
  hourLabel,
  hourRangeLabel,
  monthName,
  sportName,
  sportNameLower,
  windowDescription,
} from './format.ts';

test('formatDistance uses one decimal', () => {
  assert.equal(formatDistance(1.234), '1.2 km');
  assert.equal(formatDistance(5), '5.0 km');
});

test('formatShortWeekday', () => {
  assert.equal(formatShortWeekday('2026-11-25'), 'Wed');
  assert.equal(formatShortWeekday('nope'), 'nope');
});

test('date labels', () => {
  assert.equal(formatShortDate('2026-11-25'), 'Wed 25 Nov');
  assert.equal(formatDateLabel('2026-11-25'), 'Wed 25 Nov 2026');
  assert.equal(formatShortDate('nope'), 'nope');
  assert.equal(formatDateLabel('nope'), 'nope');
});

test('formatCheckedAgo formats minutes, hours and edge cases', () => {
  const now = new Date('2026-11-25T12:00:00Z');
  assert.equal(formatCheckedAgo('2026-11-25T11:59:50Z', now), 'just now');
  assert.equal(formatCheckedAgo('2026-11-25T11:57:00Z', now), '3 min ago');
  assert.equal(formatCheckedAgo('2026-11-25T09:30:00Z', now), '2 h ago');
  assert.equal(formatCheckedAgo('2026-11-23T09:30:00Z', now), 'over a day ago');
  assert.equal(formatCheckedAgo(undefined, now), 'recently');
  assert.equal(formatCheckedAgo('garbage', now), 'recently');
  assert.equal(formatCheckedAgo('2026-11-25T12:00:30Z', now), 'just now');
});

test('formatCourts pluralises', () => {
  assert.equal(formatCourts(1), '1 court');
  assert.equal(formatCourts(3), '3 courts');
});

test('long labels', () => {
  assert.equal(formatLongDate('2026-11-25'), 'Wednesday 25 November');
  assert.equal(formatLongDate('x'), 'x');
  assert.equal(monthName(1), 'January');
  assert.equal(hourLabel(6), '06:00');
  assert.equal(hourRangeLabel(18), '18:00–19:00');
  assert.equal(hourRangeLabel(23), '23:00–24:00');
  assert.equal(formatClockTime('2026-11-25T11:57:00Z'), '12:57');
  assert.equal(formatClockTime(undefined), '');
  assert.equal(formatClockTime('junk'), '');
  assert.equal(formatVenues(1), '1 venue');
  assert.equal(formatVenues(2), '2 venues');
});

test('sport and window descriptions come from the shared catalogue', () => {
  assert.equal(sportName('badminton'), 'Badminton');
  assert.equal(sportNameLower('badminton'), 'badminton');
  assert.equal(windowDescription(), 'today and the next 14 days');
});

test('formatSlotRange', () => {
  assert.equal(formatSlotRange({ start: '08:00', end: '10:00', freeCourts: 2 }), '08:00–10:00');
});
