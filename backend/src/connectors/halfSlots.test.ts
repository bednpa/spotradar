import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { freeSlotsFromHalfSlots } from './halfSlots.ts';
import { slot } from '../testHelpers.ts';

function slots(entries: [number, string[]][]) {
  return freeSlotsFromHalfSlots(
    new Map(entries.map(([start, courts]) => [start, new Set(courts)])),
  );
}

describe('freeSlotsFromHalfSlots', () => {
  it('returns [] for no half-slots', () => {
    assert.deepEqual(slots([]), []);
  });

  it('counts distinct courts and merges consecutive half-slots with the same count', () => {
    assert.deepEqual(
      slots([
        [420, ['a', 'b']],
        [450, ['a', 'c']],
        [480, ['a']],
      ]),
      [slot('07:00', '08:00', 2), slot('08:00', '08:30', 1)],
    );
  });

  it('does not merge across a gap or when the count changes back', () => {
    assert.deepEqual(
      slots([
        [1080, ['a']],
        [1110, ['a', 'b']],
        [1140, ['a']],
        [1200, ['a']],
      ]),
      [
        slot('18:00', '18:30', 1),
        slot('18:30', '19:00', 2),
        slot('19:00', '19:30', 1),
        slot('20:00', '20:30', 1),
      ],
    );
  });

  it('skips half-slots without any free court and sorts by start', () => {
    assert.deepEqual(
      slots([
        [510, ['a']],
        [450, []],
        [480, ['a']],
      ]),
      [slot('08:00', '09:00', 1)],
    );
  });
});
