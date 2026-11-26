import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { slot } from '../../testHelpers.ts';
import {
  RezzyParseError,
  parseRezzyArea,
  parseRezzyBlockers,
  parseTimeSpan,
  rezzyFreeSlots,
} from './parser.ts';

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

// Real recordings of TennisLinden (tenant 15, sport area 33 "Tenis - antuka"), 2026-11-26..28.
const AREA_JSON = fixture('sportarea-tenant15-area33.json');
const THU = fixture('blockers-tenant15-area33-2026-11-26.json');
const FRI = fixture('blockers-tenant15-area33-2026-11-27.json');
const SAT = fixture('blockers-tenant15-area33-2026-11-28.json');

function freeSlots(blockers: string, date: string, earliestStart = 0): ReturnType<typeof slot>[] {
  const area = parseRezzyArea(AREA_JSON, 33, date);
  return rezzyFreeSlots(area, parseRezzyBlockers(blockers, area), earliestStart);
}

describe('parseTimeSpan', () => {
  it('reads .NET TimeSpans including days', () => {
    assert.equal(parseTimeSpan('08:00:00'), 480);
    assert.equal(parseTimeSpan('14:00:00'), 840);
    assert.equal(parseTimeSpan('1.00:00:00'), 1440);
    assert.equal(parseTimeSpan('00:00:00'), 0);
  });

  it('rejects anything else', () => {
    assert.throws(() => parseTimeSpan('8h'), RezzyParseError);
    assert.throws(() => parseTimeSpan(null), RezzyParseError);
    assert.throws(() => parseTimeSpan('08:75:00'), RezzyParseError);
  });
});

describe('parseRezzyArea', () => {
  it('reads courts in display order, the grid and the hours of the weekday', () => {
    const area = parseRezzyArea(AREA_JSON, 33, '2026-11-26');
    assert.deepEqual(
      area.courts.map((c) => c.name),
      ['Kurt 1', 'Kurt 2', 'Kurt 3', 'Kurt 4'],
    );
    assert.deepEqual(
      area.courts.map((c) => c.id),
      [141, 142, 143, 150],
    );
    assert.equal(area.granularity, 30);
    assert.equal(area.minimumLength, 60);
    assert.deepEqual(area.hours, { open: 480, close: 1320 });
  });

  it('picks the weekday of the requested date', () => {
    const json = JSON.parse(AREA_JSON) as { selectedSeason: Record<string, unknown> };
    json.selectedSeason.saturday = { opensAtTime: '09:00:00', openForDuration: '1.00:00:00' };
    json.selectedSeason.sunday = { opensAtTime: '09:00:00', openForDuration: '00:00:00' };
    const body = JSON.stringify(json);
    assert.deepEqual(parseRezzyArea(body, 33, '2026-11-28').hours, { open: 540, close: 1440 });
    assert.equal(parseRezzyArea(body, 33, '2026-11-29').hours, undefined);
    assert.deepEqual(parseRezzyArea(body, 33, '2026-11-27').hours, { open: 480, close: 1320 });
  });

  it('has no hours without a season', () => {
    const json = { ...(JSON.parse(AREA_JSON) as object), selectedSeason: null };
    assert.equal(parseRezzyArea(JSON.stringify(json), 33, '2026-11-26').hours, undefined);
  });

  it('throws on a changed structure', () => {
    assert.throws(() => parseRezzyArea('<html>', 33, '2026-11-26'), RezzyParseError);
    assert.throws(() => parseRezzyArea('[]', 33, '2026-11-26'), RezzyParseError);
    assert.throws(() => parseRezzyArea(AREA_JSON, 34, '2026-11-26'), /not 34/);
    const noFields = { ...(JSON.parse(AREA_JSON) as object), availablePlayfields: [] };
    assert.throws(
      () => parseRezzyArea(JSON.stringify(noFields), 33, '2026-11-26'),
      RezzyParseError,
    );
    const noGrid = { ...(JSON.parse(AREA_JSON) as object), reservationGranularity: undefined };
    assert.throws(() => parseRezzyArea(JSON.stringify(noGrid), 33, '2026-11-26'), RezzyParseError);
    const otherGrid = { ...(JSON.parse(AREA_JSON) as object), reservationGranularity: 45 };
    assert.throws(() => parseRezzyArea(JSON.stringify(otherGrid), 33, '2026-11-26'), /granularity/);
    const noDay = { ...(JSON.parse(AREA_JSON) as object), selectedSeason: { id: 1 } };
    assert.throws(() => parseRezzyArea(JSON.stringify(noDay), 33, '2026-11-26'), RezzyParseError);
  });
});

describe('parseRezzyBlockers', () => {
  it('maps the inclusive playfield span to court positions', () => {
    const area = parseRezzyArea(AREA_JSON, 33, '2026-11-26');
    const blocks = parseRezzyBlockers(THU, area);
    assert.equal(blocks.length, 8);
    assert.deepEqual(blocks[0], { from: 0, to: 3, start: 480, end: 540 }); // 141..150 = all four
    assert.deepEqual(blocks[3], { from: 1, to: 2, start: 570, end: 660 }); // Kurt 2 + Kurt 3
  });

  it('accepts an empty array and a "1.00:00:00" end', () => {
    const area = parseRezzyArea(AREA_JSON, 33, '2026-11-26');
    assert.deepEqual(parseRezzyBlockers('[]', area), []);
    const midnight = JSON.stringify([
      {
        sportAreaId: 33,
        playfieldIdFrom: 141,
        playfieldIdTo: 141,
        from: '20:00:00',
        to: '1.00:00:00',
      },
    ]);
    assert.deepEqual(parseRezzyBlockers(midnight, area), [
      { from: 0, to: 0, start: 1200, end: 1440 },
    ]);
  });

  it('throws on a changed structure', () => {
    const area = parseRezzyArea(AREA_JSON, 33, '2026-11-26');
    assert.throws(() => parseRezzyBlockers('nope', area), RezzyParseError);
    assert.throws(() => parseRezzyBlockers('{"blockers":[]}', area), RezzyParseError);
    const block = {
      sportAreaId: 33,
      playfieldIdFrom: 141,
      playfieldIdTo: 150,
      from: '08:00:00',
      to: '09:00:00',
    };
    assert.throws(
      () => parseRezzyBlockers(JSON.stringify([{ ...block, sportAreaId: 34 }]), area),
      RezzyParseError,
    );
    assert.throws(
      () => parseRezzyBlockers(JSON.stringify([{ ...block, playfieldIdTo: 999 }]), area),
      /unknown playfield/,
    );
    assert.throws(
      () =>
        parseRezzyBlockers(
          JSON.stringify([{ ...block, playfieldIdFrom: 150, playfieldIdTo: 141 }]),
          area,
        ),
      RezzyParseError,
    );
    assert.throws(
      () => parseRezzyBlockers(JSON.stringify([{ ...block, from: '10:00:00' }]), area),
      RezzyParseError,
    );
    assert.throws(
      () => parseRezzyBlockers(JSON.stringify([{ ...block, from: undefined }]), area),
      RezzyParseError,
    );
  });
});

describe('rezzyFreeSlots (TennisLinden, recorded 2026-11-26..28)', () => {
  it('Thursday: opening hours minus blocks per court, runs shorter than 60 min dropped', () => {
    assert.deepEqual(freeSlots(THU, '2026-11-26'), [
      slot('09:00', '11:00', 2), // Kurt 2 / 3 have only 30 min before their 09:30 block
      slot('11:00', '14:00', 4),
      slot('14:00', '14:30', 3),
      slot('14:30', '15:00', 1),
      slot('16:00', '17:00', 1),
      slot('18:00', '19:30', 1),
      slot('19:30', '20:00', 2),
      slot('20:00', '22:00', 4),
    ]);
  });

  it('Friday: several gaps per court, everything blocked 21-22', () => {
    assert.deepEqual(freeSlots(FRI, '2026-11-27'), [
      slot('08:00', '09:00', 2),
      slot('09:00', '10:00', 1),
      slot('10:30', '11:00', 1),
      slot('11:00', '14:00', 2),
      slot('17:00', '18:00', 1),
      slot('18:00', '19:00', 3),
      slot('19:00', '21:00', 4),
    ]);
  });

  it('Saturday: the whole hall blocked all day has no free slot', () => {
    assert.deepEqual(freeSlots(SAT, '2026-11-28'), []);
  });

  it('no blockers: the opening hours are free on every court', () => {
    assert.deepEqual(freeSlots('[]', '2026-11-26'), [slot('08:00', '22:00', 4)]);
  });

  it('drops cells that already started today, then applies the minimum length', () => {
    // 12:10 -> first cell 12:30.
    assert.deepEqual(freeSlots(THU, '2026-11-26', 12 * 60 + 10).slice(0, 3), [
      slot('12:30', '14:00', 4),
      slot('14:00', '14:30', 3),
      slot('14:30', '15:00', 1),
    ]);
    // 13:40 -> from 14:00; Kurt 1 / Kurt 3 have only 30 min left before their blocks.
    assert.deepEqual(freeSlots(THU, '2026-11-26', 13 * 60 + 40), [
      slot('14:00', '15:00', 1),
      slot('16:00', '17:00', 1),
      slot('18:00', '19:30', 1),
      slot('19:30', '20:00', 2),
      slot('20:00', '22:00', 4),
    ]);
    assert.deepEqual(freeSlots(THU, '2026-11-26', 22 * 60), []);
  });

  it('a closed day has no free slot', () => {
    const json = JSON.parse(AREA_JSON) as { selectedSeason: Record<string, unknown> };
    json.selectedSeason.thursday = { opensAtTime: '08:00:00', openForDuration: '00:00:00' };
    const area = parseRezzyArea(JSON.stringify(json), 33, '2026-11-26');
    assert.deepEqual(rezzyFreeSlots(area, []), []);
  });

  it('opening until midnight ("1.00:00:00") reaches 24:00', () => {
    const json = JSON.parse(AREA_JSON) as { selectedSeason: Record<string, unknown> };
    json.selectedSeason.thursday = { opensAtTime: '22:00:00', openForDuration: '1.00:00:00' };
    const area = parseRezzyArea(JSON.stringify(json), 33, '2026-11-26');
    assert.deepEqual(rezzyFreeSlots(area, []), [slot('22:00', '24:00', 4)]);
  });
});
