import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatCheckedAgo,
  formatCourts,
  formatDateLabel,
  formatDistance,
  formatShortDate,
  formatSlotRange,
} from './format.ts';

test('formatDistance uses one decimal', () => {
  assert.equal(formatDistance(1.234), '1.2 km');
  assert.equal(formatDistance(5), '5.0 km');
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

test('formatSlotRange', () => {
  assert.equal(formatSlotRange({ start: '08:00', end: '10:00', freeCourts: 2 }), '08:00–10:00');
});
