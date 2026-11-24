import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatCzk,
  formatDateLabel,
  formatDistance,
  formatDuration,
  formatOpeningHours,
  formatPrice,
  formatTimeRange,
} from './format.ts';

test('formats prices', () => {
  assert.equal(formatCzk(350), '350 CZK');
  assert.equal(formatPrice(350, 525), '350 CZK / hour · 525 CZK total');
});

test('formats distance with one decimal', () => {
  assert.equal(formatDistance(1.2), '1.2 km');
  assert.equal(formatDistance(3), '3.0 km');
});

test('formats duration, opening hours and time range', () => {
  assert.equal(formatDuration(90), '90 min');
  assert.equal(formatOpeningHours({ open: '08:00', close: '22:00' }), '08:00–22:00');
  assert.equal(formatTimeRange('18:00', 90), '18:00–19:30');
  assert.equal(formatTimeRange('21:30', 120), '21:30–23:30');
});

test('formats date labels deterministically', () => {
  assert.equal(formatDateLabel('2026-11-25'), 'Wed 25 Nov 2026');
  assert.equal(formatDateLabel('garbage'), 'garbage');
});
