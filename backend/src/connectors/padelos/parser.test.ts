import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { slot } from '../../testHelpers.ts';
import { PadelosParseError, parsePadelosAvailability } from './parser.ts';

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

// Real recordings of api.padelos.co (Padel Powers Brno, Slatina 216930 / Kraví hora 216928),
// trimmed by backend/scripts/sanitize-padelos-fixtures.ts.
const THU = fixture('slatina-2026-11-26.json');
const FRI = fixture('slatina-2026-11-27.json');
const SAT = fixture('slatina-2026-11-28.json');
const KRAVI_HORA = fixture('kravihora-2026-11-26.json');

describe('parsePadelosAvailability (recorded 2026-11-26..28)', () => {
  it('Thursday evening: unions the duration groups per court and counts courts per interval', () => {
    // Courts 2 + 5 are offered 21-23, court 1/3/4/6/10 only 21:30-23 (a 90 min offer; the 60 min
    // offer 22-23 is hidden by the server), courts 7/8/9 22-23.
    assert.deepEqual(parsePadelosAvailability(THU, '216930', '2026-11-26'), [
      slot('21:00', '21:30', 2),
      slot('21:30', '22:00', 7),
      slot('22:00', '23:00', 10),
    ]);
  });

  it('Friday and Saturday match an independent per-court computation', () => {
    for (const [body, date] of [
      [FRI, '2026-11-27'],
      [SAT, '2026-11-28'],
    ] as const) {
      assert.deepEqual(parsePadelosAvailability(body, '216930', date), bruteForce(body));
    }
  });

  it('Friday has real free time on several courts, sorted and merged', () => {
    // 19:00-20:00 is fully booked, so there is a gap.
    assert.deepEqual(parsePadelosAvailability(FRI, '216930', '2026-11-27'), [
      slot('07:00', '08:00', 5),
      slot('08:00', '08:30', 7),
      slot('08:30', '09:00', 9),
      slot('09:00', '10:00', 10),
      slot('10:00', '11:00', 8),
      slot('11:00', '11:30', 6),
      slot('11:30', '12:30', 8),
      slot('12:30', '13:00', 10),
      slot('13:00', '14:30', 9),
      slot('14:30', '15:00', 8),
      slot('15:00', '15:30', 7),
      slot('15:30', '16:00', 4),
      slot('16:00', '19:00', 1),
      slot('20:00', '20:30', 2),
      slot('20:30', '21:00', 3),
      slot('21:00', '21:30', 5),
      slot('21:30', '22:00', 9),
      slot('22:00', '23:00', 10),
    ]);
  });

  it('an empty availability (Kraví hora in winter) is a valid empty day', () => {
    assert.deepEqual(parsePadelosAvailability(KRAVI_HORA, '216928', '2026-11-26'), []);
  });

  it('takes the union of overlapping offers and an end time of 00:00 as midnight', () => {
    const body = JSON.stringify({
      data: [
        {
          id: '1',
          availability: [
            {
              duration: '60',
              slots: [
                { date: '2026-12-01', startTime: '23:00', endTime: '00:00', courts: [{ id: 'a' }] },
              ],
            },
            {
              duration: '90',
              slots: [
                {
                  date: '2026-12-01',
                  startTime: '22:30',
                  endTime: '00:00',
                  courts: [{ id: 'a' }, { id: 'b' }],
                },
              ],
            },
          ],
        },
      ],
    });
    assert.deepEqual(parsePadelosAvailability(body, '1', '2026-12-01'), [
      slot('22:30', '24:00', 2),
    ]);
  });

  it('throws when the structure is missing or changed', () => {
    const club = (extra: object): string =>
      JSON.stringify({ data: [{ id: '216930', availability: [], ...extra }] });
    assert.throws(
      () => parsePadelosAvailability('<html>', '216930', '2026-11-26'),
      PadelosParseError,
    );
    assert.throws(() => parsePadelosAvailability('{}', '216930', '2026-11-26'), /no data\[0\]/);
    assert.throws(
      () => parsePadelosAvailability('{"data":[]}', '216930', '2026-11-26'),
      PadelosParseError,
    );
    assert.throws(
      () => parsePadelosAvailability(club({ availability: undefined }), '216930', '2026-11-26'),
      /availability/,
    );
    assert.throws(
      () => parsePadelosAvailability(club({ availability: {} }), '216930', '2026-11-26'),
      PadelosParseError,
    );
    assert.throws(
      () => parsePadelosAvailability(club({ availability: [{}] }), '216930', '2026-11-26'),
      PadelosParseError,
    );
    assert.throws(() => parsePadelosAvailability(THU, '216928', '2026-11-26'), /not 216928/);
    assert.throws(() => parsePadelosAvailability(THU, '216930', '2026-11-27'), /not 2026-11-27/);
  });

  it('throws on slots it cannot read', () => {
    const withSlot = (s: object): string =>
      JSON.stringify({
        data: [
          {
            id: '1',
            availability: [{ duration: '60', slots: [{ date: 'd', courts: [{ id: 'a' }], ...s }] }],
          },
        ],
      });
    const ok = { date: 'd', startTime: '10:00', endTime: '11:00' };
    assert.deepEqual(parsePadelosAvailability(withSlot(ok), '1', 'd'), [slot('10:00', '11:00', 1)]);
    assert.throws(
      () => parsePadelosAvailability(withSlot({ ...ok, startTime: '10:15' }), '1', 'd'),
      /grid/,
    );
    assert.throws(
      () => parsePadelosAvailability(withSlot({ ...ok, startTime: undefined }), '1', 'd'),
      PadelosParseError,
    );
    assert.throws(
      () => parsePadelosAvailability(withSlot({ ...ok, endTime: '09:30' }), '1', 'd'),
      /before/,
    );
    assert.throws(
      () => parsePadelosAvailability(withSlot({ ...ok, courts: undefined }), '1', 'd'),
      /no courts/,
    );
    assert.throws(
      () => parsePadelosAvailability(withSlot({ ...ok, courts: [{}] }), '1', 'd'),
      /no id/,
    );
  });
});

/** Independent oracle: per half-hour count the distinct courts that have any offer covering it. */
function bruteForce(body: string): ReturnType<typeof slot>[] {
  const data = JSON.parse(body) as {
    data: {
      availability: {
        slots: { startTime: string; endTime: string; courts: { id: string }[] }[];
      }[];
    }[];
  };
  const toMin = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const offers: { court: string; from: number; to: number }[] = [];
  for (const group of data.data[0]?.availability ?? []) {
    for (const s of group.slots) {
      for (const c of s.courts)
        offers.push({ court: c.id, from: toMin(s.startTime), to: toMin(s.endTime) });
    }
  }
  const fmt = (m: number): string =>
    `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const out: ReturnType<typeof slot>[] = [];
  for (let t = 0; t < 1440; t += 30) {
    const n = new Set(offers.filter((o) => o.from <= t && t < o.to).map((o) => o.court)).size;
    if (n === 0) continue;
    const last = out[out.length - 1];
    if (last && last.end === fmt(t) && last.freeCourts === n) last.end = fmt(t + 30);
    else out.push(slot(fmt(t), fmt(t + 30), n));
  }
  return out;
}
