import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { slot } from '../../testHelpers.ts';
import { IsportsystemParseError, czechWeekdayName, parseIsportsystemDay } from './parser.ts';

/** Real answer of Squash Slovan for 26.-29.11.2026 (recorded on the 26th in the evening). */
const HTML = readFileSync(
  new URL('./fixtures/slovan-2026-11-26-schema.html', import.meta.url),
  'utf8',
);

describe('parseIsportsystemDay', () => {
  it('26.11. (today): past cells are not free, "only by phone" cells are', () => {
    // Court 3 is booked at 19:00-20:00, courts 1 and 2 are tdNoBooking there.
    assert.deepEqual(parseIsportsystemDay(HTML, '2026-11-26'), [slot('19:00', '20:00', 2)]);
  });

  it('27.11.: free cells around the technical break (colspan) are counted per court', () => {
    assert.deepEqual(parseIsportsystemDay(HTML, '2026-11-27'), [
      slot('06:00', '08:00', 3),
      slot('15:00', '17:00', 3),
      slot('17:00', '18:00', 2),
    ]);
  });

  it('28.11. and 29.11.: everything booked, even a short schema (no free slot)', () => {
    assert.deepEqual(parseIsportsystemDay(HTML, '2026-11-28'), []);
    assert.deepEqual(parseIsportsystemDay(HTML, '2026-11-29'), []);
  });

  it('treats an "empty" (Volno) cell as free', () => {
    // Derived from the recording: the first booked cell of 28.11. (court 1, 8:00) turned into Volno.
    const volno = HTML.replace(
      'class="booked tooltip" title="8:00–8:30 - Obsazeno"',
      'class="empty tooltip" title="8:00–8:30 - Volno"',
    );
    assert.notEqual(volno, HTML);
    assert.deepEqual(parseIsportsystemDay(volno, '2026-11-28'), [slot('08:00', '08:30', 1)]);
  });

  it('infers the year from the request, also over New Year', () => {
    // 2027-01-02 is a Saturday, like the recorded 28.11. -> the heading "Sobota 2.1." matches it.
    const shifted = HTML.replace('Sobota 28.11.', 'Sobota 2.1.');
    assert.deepEqual(parseIsportsystemDay(shifted, '2027-01-02'), []);
    assert.throws(() => parseIsportsystemDay(shifted, '2026-11-28'), IsportsystemParseError);
  });

  it('throws when the day is not in the answer or its weekday does not match', () => {
    assert.throws(() => parseIsportsystemDay(HTML, '2026-11-30'), /not in the answer/);
    // 28.11.2027 is a Sunday, not a Saturday.
    assert.throws(() => parseIsportsystemDay(HTML, '2027-11-28'), IsportsystemParseError);
  });

  it('throws on changed markup instead of returning partial data', () => {
    assert.throws(() => parseIsportsystemDay('<html>Nová stránka</html>', '2026-11-26'), /no day/);
    const noTable = HTML.replaceAll(
      'class="schema schemaIndividual',
      'class="grid schemaIndividual',
    );
    assert.throws(() => parseIsportsystemDay(noTable, '2026-11-27'), /no schema table/);
    const noLanes = HTML.replaceAll('trSchemaLane_', 'trCourt_');
    assert.throws(() => parseIsportsystemDay(noLanes, '2026-11-27'), /no courts/);
    const noHeader = HTML.replaceAll('<tr class="times">', '<tr class="hours">');
    assert.throws(() => parseIsportsystemDay(noHeader, '2026-11-27'), /time header/);
    // A cell whose title disagrees with its column position (e.g. a lost cell).
    const shifted = HTML.replace(
      '<td title="6:00–6:30 Rezervace pouze telefonicky" class="tooltip curHelp tdNoBooking"><div class="divHour"><span  class=""></span></div></td>',
      '',
    );
    assert.notEqual(shifted, HTML);
    assert.throws(() => parseIsportsystemDay(shifted, '2026-11-27'), /does not match its column/);
  });
});

describe('czechWeekdayName', () => {
  it('names the weekday', () => {
    assert.equal(czechWeekdayName('2026-11-26'), 'Čtvrtek');
    assert.equal(czechWeekdayName('2026-11-29'), 'Neděle');
  });
});
