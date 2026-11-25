import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOOKING_SYSTEMS,
  BOOKING_SYSTEM_LABELS,
  DEFAULT_SPORT_ID,
  SPORTS,
  SPORT_IDS,
  isSportId,
  sportInfo,
} from './catalog.ts';

test('SPORTS: one entry per sport id, in id order, with English + Czech name and icon', () => {
  assert.deepEqual(
    SPORTS.map((sport) => sport.id),
    [...SPORT_IDS],
  );
  for (const sport of SPORTS) {
    assert.ok(sport.name.trim() !== '', sport.id);
    assert.ok(sport.nameCs.trim() !== '', sport.id);
    assert.ok(sport.icon.trim() !== '', sport.id);
  }
  assert.equal(sportInfo('table-tennis').nameCs, 'Stolní tenis');
  assert.equal(sportInfo('beach-volleyball').name, 'Beach volleyball');
});

test('sport ids are URL-safe and recognised by isSportId', () => {
  for (const id of SPORT_IDS) {
    assert.match(id, /^[a-z]+(-[a-z]+)*$/);
    assert.equal(isSportId(id), true);
  }
  assert.equal(isSportId('Tennis'), false);
  assert.equal(isSportId('golf'), false);
  assert.equal(isSportId(undefined), false);
  assert.equal(isSportId(DEFAULT_SPORT_ID), true);
});

test('every booking system has a label', () => {
  for (const system of BOOKING_SYSTEMS) {
    assert.ok(BOOKING_SYSTEM_LABELS[system].trim() !== '', system);
  }
});
