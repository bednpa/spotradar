import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  fnv1a,
  isSlotOccupiedExternally,
  occupancyThresholdPercent,
} from './occupancy.ts';

describe('occupancy simulation', () => {
  it('fnv1a matches known test vectors', () => {
    assert.equal(fnv1a(''), 0x811c9dc5);
    assert.equal(fnv1a('a'), 0xe40c292c);
    assert.equal(fnv1a('foobar'), 0xbf9cf968);
  });

  it('is deterministic', () => {
    const a = isSlotOccupiedExternally('venue-x-court-1', '2026-11-25', 600);
    for (let i = 0; i < 5; i++) {
      assert.equal(isSlotOccupiedExternally('venue-x-court-1', '2026-11-25', 600), a);
    }
  });

  it('uses a higher threshold during the evening peak', () => {
    assert.equal(occupancyThresholdPercent(16 * 60 + 30), 35);
    assert.equal(occupancyThresholdPercent(17 * 60), 55);
    assert.equal(occupancyThresholdPercent(20 * 60 + 30), 55);
    assert.equal(occupancyThresholdPercent(21 * 60), 35);
  });

  it('produces a plausible share of occupied slots, higher at peak', () => {
    let off = 0;
    let peak = 0;
    const samples = 1500;
    for (let i = 0; i < samples; i++) {
      if (isSlotOccupiedExternally(`court-${i}`, '2026-11-25', 600)) off++;
      if (isSlotOccupiedExternally(`court-${i}`, '2026-11-25', 1100)) peak++;
    }
    assert.ok(off / samples > 0.2 && off / samples < 0.5, `off-peak share ${off / samples}`);
    assert.ok(peak / samples > 0.4 && peak / samples < 0.7, `peak share ${peak / samples}`);
    assert.ok(peak > off);
  });
});
