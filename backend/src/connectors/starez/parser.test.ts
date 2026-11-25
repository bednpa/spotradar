import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { slot } from '../../testHelpers.ts';
import {
  StarezParseError,
  parseStarezGrid,
  starezReservationHtml,
  toStarezDate,
} from './parser.ts';

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

// Real recordings of https://beach.starez.cz/vstupenky-rezervace (customer surnames replaced).
const TODAY = fixture('beach-2026-11-25-today.html');
const THU = fixture('beach-2026-11-26-ajax.json');
const SAT = fixture('beach-2026-11-28-ajax.json');
const FACILITY = 'Beachvolejbal';

describe('parseStarezGrid (Beach Riviéra, recorded 2026-11-25)', () => {
  it('counts the free "volno k rezervaci" cells of the full page (today) per court', () => {
    assert.deepEqual(parseStarezGrid(TODAY, '2026-11-25', FACILITY), [
      slot('15:00', '16:00', 2),
      slot('20:00', '21:00', 1),
    ]);
  });

  it('reads the JSON answer of the AJAX date switch: a fully booked Thursday and Saturday', () => {
    // Booked cells carry names (clubs, "Rezervováno"), grey cells are not available.
    assert.deepEqual(parseStarezGrid(THU, '2026-11-26', FACILITY), []);
    assert.deepEqual(parseStarezGrid(SAT, '2026-11-28', FACILITY), []);
  });

  it('treats a multi-hour free cell as free for every half hour it covers', () => {
    const html = TODAY.replace(
      '<span class="block-time">15:00-16:00</span>',
      '<span class="block-time">15:00-17:00</span>',
    );
    const slots = parseStarezGrid(html, '2026-11-25', FACILITY);
    assert.deepEqual(slots[0], slot('15:00', '16:00', 2));
    assert.ok(slots.some((s) => s.start === '16:00' && s.end === '17:00'));
  });

  it('rejects a page that shows another day (never returns another day’s data)', () => {
    assert.throws(() => parseStarezGrid(TODAY, '2026-11-26', FACILITY), StarezParseError);
    assert.throws(() => parseStarezGrid(THU, '2026-11-25', FACILITY), /shows 2026-11-26/);
  });

  it('rejects a missing facility, missing grid and changed cell markup', () => {
    assert.throws(() => parseStarezGrid(TODAY, '2026-11-25', 'Tenis'), /"Tenis" not found/);
    assert.throws(
      () => parseStarezGrid('<html><body>Údržba</body></html>', '2026-11-25', FACILITY),
      /No STAREZ reservation grid/,
    );
    const noTimes = TODAY.replaceAll('class="block-time"', 'class="time-label"');
    assert.throws(() => parseStarezGrid(noTimes, '2026-11-25', FACILITY), /no time range/);
    const noCourts = TODAY.replaceAll('facility-group__unit-row', 'facility-group__other');
    assert.throws(() => parseStarezGrid(noCourts, '2026-11-25', FACILITY), /no courts/);
  });
});

describe('starezReservationHtml', () => {
  it('returns HTML unchanged and unwraps the snippet of a JSON answer', () => {
    assert.equal(starezReservationHtml('<div>x</div>'), '<div>x</div>');
    assert.equal(
      starezReservationHtml('{"snippets":{"snippet--reservation":"<div>y</div>"}}'),
      '<div>y</div>',
    );
  });

  it('rejects broken JSON and JSON without the reservation snippet', () => {
    assert.throws(() => starezReservationHtml('{"snippets":'), StarezParseError);
    assert.throws(() => starezReservationHtml('{"redirect":"/"}'), /no snippet--reservation/);
  });
});

describe('toStarezDate', () => {
  it('formats DD.MM.YYYY', () => {
    assert.equal(toStarezDate('2026-11-05'), '05.11.2026');
  });
});
