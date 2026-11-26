import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BOOKING_SYSTEMS,
  SPORT_IDS,
  WEEKDAYS,
  courtPrice,
  isValidTime,
  offeringFor,
  offeringIssues,
  priceFor,
  timeToMinutes,
  validateMultisport,
  validatePricing,
} from '@spotradar/shared';
import type { SportId, SportOfferingConfig } from '@spotradar/shared';
import {
  createVenueRepository,
  toPublicOffering,
  toPublicVenue,
} from '../repositories/venueRepository.ts';
import type { VenueRecord } from '../repositories/venueRepository.ts';
import { VENUE_RECORDS } from './venues.ts';

const byId = new Map(VENUE_RECORDS.map((v) => [v.id, v]));

function venue(id: string): VenueRecord {
  const found = byId.get(id);
  if (!found) throw new Error(`unknown venue ${id}`);
  return found;
}

function offering(id: string, sport: SportId = 'badminton'): SportOfferingConfig {
  const found = offeringFor(venue(id), sport);
  if (!found) throw new Error(`${id} has no ${sport}`);
  return found;
}

const allOfferings = VENUE_RECORDS.flatMap((v) => v.offerings.map((o) => ({ venue: v, o })));

/** The seven original badminton venues (complete, verified price lists). */
const BADMINTON_IDS = [
  'badminton-jehnice',
  'badminton-lisen',
  'centrum-viktoria',
  'hala-sprint',
  'kuklenska',
  'sportcentrum-ivanovice',
  'x-arena-slatina',
];

describe('venue data', () => {
  it('has unique ids and keeps the seven badminton venues', () => {
    const ids = VENUE_RECORDS.map((v) => v.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(
      VENUE_RECORDS.filter((v) => offeringFor(v, 'badminton'))
        .map((v) => v.id)
        .toSorted(),
      BADMINTON_IDS,
    );
  });

  it('has venues for every sport', () => {
    for (const sport of SPORT_IDS) {
      assert.ok(
        VENUE_RECORDS.some((v) => offeringFor(v, sport)),
        `no venue for ${sport}`,
      );
    }
  });

  it('has coordinates inside Brno and non-empty texts', () => {
    for (const v of VENUE_RECORDS) {
      assert.ok(v.location.lat > 49.0 && v.location.lat < 49.4, `${v.id} lat`);
      assert.ok(v.location.lng > 16.4 && v.location.lng < 16.8, `${v.id} lng`);
      assert.ok(v.name !== '' && v.district.startsWith('Brno-') && v.address.endsWith(', Brno'));
    }
  });

  it('has valid offerings: at least one, one per sport, known sport and booking system', () => {
    for (const v of VENUE_RECORDS) {
      assert.deepEqual(offeringIssues(toPublicVenue(v)), [], v.id);
      for (const o of v.offerings) {
        assert.ok((SPORT_IDS as readonly string[]).includes(o.sport), `${v.id} ${o.sport}`);
        assert.ok(
          (BOOKING_SYSTEMS as readonly string[]).includes(o.bookingSystem),
          `${v.id} ${o.sport}`,
        );
        if (o.courts !== undefined) assert.ok(Number.isInteger(o.courts) && o.courts > 0);
      }
    }
  });

  it('keeps availabilitySource equal to source.type for every offering', () => {
    for (const { venue: v, o } of allOfferings) {
      assert.equal(o.availabilitySource, o.source.type, `${v.id} ${o.sport}`);
    }
  });

  it('uses valid http(s) URLs and booking URLs derived from the connector source', () => {
    for (const { venue: v, o } of allOfferings) {
      const label = `${v.id} ${o.sport}`;
      assert.match(o.bookingUrl, /^https?:\/\//, label);
      assert.doesNotThrow(() => new URL(o.bookingUrl), label);
      if (o.source.type === 'clubspire') {
        assert.equal(o.bookingUrl, `${o.source.baseUrl}timeline/day?tabIdx=${o.source.tabIdx}`);
      } else if (o.source.type === 'bizzy') {
        assert.equal(o.bookingUrl, o.source.scheduleUrl, label);
      } else if (o.source.type !== 'none') {
        assert.equal(o.bookingUrl, o.source.url, label);
      }
      // The booking system of a connector source is that system.
      if (o.source.type !== 'none') assert.equal(o.bookingSystem, o.source.type, label);
    }
    for (const v of VENUE_RECORDS) {
      if (v.website !== undefined) assert.doesNotThrow(() => new URL(v.website ?? ''), v.id);
    }
  });

  it('has valid MultiSport terms, pricing and activity details', () => {
    for (const { venue: v, o } of allOfferings) {
      const label = `${v.id} ${o.sport}`;
      assert.deepEqual(validateMultisport(o.multisport), [], label);
      if (o.pricing) assert.deepEqual(validatePricing(o.pricing), [], label);
    }
    for (const v of VENUE_RECORDS) {
      // Only searchable sports are listed; unsupported activities (bowling, golf…) are not.
      assert.ok(!('otherActivities' in v), v.id);
    }
  });

  it('only prices hours the offering is open', () => {
    for (const { venue: v, o } of allOfferings) {
      if (!o.pricing || !o.openingHours) continue;
      for (const r of o.pricing.rules) {
        for (const day of r.days) {
          const hours = o.openingHours.days[day];
          const label = `${v.id} ${o.sport} ${day}`;
          assert.ok(hours, `${label} open`);
          assert.ok(timeToMinutes(r.from) >= timeToMinutes(hours.open), `${label} from`);
          assert.ok(timeToMinutes(r.to) <= timeToMinutes(hours.close), `${label} to`);
        }
      }
    }
  });

  it('has complete badminton price lists covering every open hour', () => {
    for (const id of BADMINTON_IDS) {
      const o = offering(id);
      assert.ok(o.pricing && o.openingHours, id);
      // 2026-11-23 is a Monday.
      WEEKDAYS.forEach((day, i) => {
        const date = `2026-11-${String(23 + i).padStart(2, '0')}`;
        const hours = o.openingHours?.days[day];
        assert.ok(hours, `${id} ${day}`);
        const first = timeToMinutes(hours.open) / 60;
        const last = timeToMinutes(hours.close) / 60;
        for (let h = first; h < last; h++) {
          assert.notEqual(priceFor(o.pricing, date, h), null, `${id} ${day} ${h}:00`);
        }
        assert.equal(priceFor(o.pricing, date, last), null, `${id} ${day} after close`);
      });
    }
  });

  it('has HH:MM opening hours with open before close and valid seasons', () => {
    for (const { venue: v, o } of allOfferings) {
      if (!o.openingHours) continue;
      for (const day of WEEKDAYS) {
        const hours = o.openingHours.days[day];
        if (!hours) continue;
        const label = `${v.id} ${o.sport} ${day}`;
        assert.ok(isValidTime(hours.open) && isValidTime(hours.close), label);
        assert.ok(hours.open < hours.close, label);
      }
      const season = o.openingHours.season;
      if (season) {
        assert.match(season.from, /^\d{2}-\d{2}$/);
        assert.match(season.to, /^\d{2}-\d{2}$/);
      }
    }
  });

  it('spot-checks concrete prices', () => {
    const price = (id: string, date: string, time: number | string, sport: SportId = 'badminton') =>
      priceFor(offering(id, sport).pricing, date, time);
    assert.equal(price('kuklenska', '2026-11-25', 14), 280); // Wed
    assert.equal(price('kuklenska', '2026-11-25', '15:00'), 380);
    assert.equal(price('kuklenska', '2026-11-28', 10), 330); // Sat before 15:00
    assert.equal(price('kuklenska', '2026-11-28', 15), 380);
    assert.equal(price('kuklenska', '2026-11-29', 21), null); // closed
    assert.equal(price('badminton-jehnice', '2026-11-25', 16), 240);
    assert.equal(price('badminton-jehnice', '2026-11-25', 10), null); // closed
    assert.equal(price('sportcentrum-ivanovice', '2026-11-27', 20), 440); // Fri
    assert.equal(price('sportcentrum-ivanovice', '2026-11-27', 21), null); // Fri closed
    assert.equal(price('centrum-viktoria', '2026-11-25', 16, 'squash'), 370);
    assert.equal(price('centrum-viktoria', '2026-11-28', 10, 'padel'), 800);
    assert.equal(price('hala-sprint', '2026-11-25', 16, 'tennis'), 750);
    assert.equal(price('hala-sprint', '2026-11-25', 21, 'tennis'), 550);
    assert.equal(price('fitness-boby', '2026-11-26', 18, 'squash'), 320); // Thu
    assert.equal(price('fitness-boby', '2026-11-27', 18, 'squash'), null); // Fri unknown
  });

  it('describes MultiSport terms per venue and sport', () => {
    const ms = (id: string, sport: SportId = 'badminton') => offering(id, sport).multisport;
    assert.deepEqual(ms('kuklenska'), { category: 'half-per-card' });
    assert.deepEqual(ms('centrum-viktoria'), { category: 'minutes-per-card', minutesPerCard: 30 });
    assert.deepEqual(ms('centrum-viktoria', 'padel'), {
      category: 'minutes-per-card',
      minutesPerCard: 15,
    });
    assert.deepEqual(ms('badminton-jehnice'), { category: 'unknown' });
    assert.deepEqual(ms('x-arena-slatina'), {
      category: 'half-per-card',
      limits: { maxPlayersPerCourt: 4 },
    });
    assert.deepEqual(ms('hala-sprint', 'tennis'), { category: 'unknown' });
    assert.equal(ms('sportcentrum-ivanovice', 'squash').category, 'full-two-cards');
    assert.deepEqual(ms('sportcentrum-ivanovice', 'table-tennis'), { category: 'unknown' });
    assert.deepEqual(ms('fitness-boby', 'squash'), {
      category: 'minutes-per-card',
      minutesPerCard: 30,
    });
  });

  it('computes court prices with MultiSport cards on real data', () => {
    const at = (id: string, date: string, hour: number, cards: number, sport: SportId) => {
      const o = offering(id, sport);
      return courtPrice({ pricing: o.pricing, multisport: o.multisport, date, hour, cards });
    };
    // Ivanovice: 2 cards pay the whole court (440 Kč Wed evening).
    assert.deepEqual(at('sportcentrum-ivanovice', '2026-11-25', 18, 2, 'badminton'), {
      basePrice: 440,
      cardsUsed: 2,
      payable: 0,
    });
    // X-Arena: 4 cards requested, half-per-card makes only 2 useful.
    assert.equal(at('x-arena-slatina', '2026-11-25', 18, 4, 'badminton')?.cardsUsed, 2);
    // Viktoria squash: 1 card = 30 min of 370 Kč.
    assert.deepEqual(at('centrum-viktoria', '2026-11-25', 18, 1, 'squash'), {
      basePrice: 370,
      cardsUsed: 1,
      payable: 185,
    });
    // Unknown terms: cards are never applied.
    assert.deepEqual(at('hala-sprint', '2026-11-25', 18, 2, 'badminton'), {
      basePrice: 380,
      cardsUsed: 0,
      payable: 380,
    });
  });

  it('matches the researched values of individual venues and sports', () => {
    assert.equal(offering('centrum-viktoria').courts, 3);
    assert.deepEqual(offering('centrum-viktoria').openingHours?.days.sat, {
      open: '08:00',
      close: '22:00',
    });
    assert.deepEqual(offering('badminton-jehnice').openingHours?.days.tue, {
      open: '14:00',
      close: '22:00',
    });
    assert.equal(offering('badminton-lisen').openingHours?.approximate, true);
    assert.deepEqual(offering('sportcentrum-ivanovice').openingHours?.days.fri, {
      open: '07:00',
      close: '21:00',
    });
    assert.equal(
      offering('kuklenska').bookingUrl,
      'https://kuklenska.clubspire.cz/timeline/day?tabIdx=0',
    );
    // Per-sport connector sources.
    assert.deepEqual(offering('centrum-viktoria', 'padel').source, {
      type: 'clubspire',
      baseUrl: 'https://rezervace.centrumviktoria.cz:18443/',
      tabIdx: 3,
      courtNamePrefixes: ['Padel'],
    });
    assert.equal(offering('centrum-viktoria', 'tennis').source.type, 'none');
    assert.deepEqual(offering('centrum-viktoria', 'beach-volleyball').openingHours?.season, {
      from: '05-01',
      to: '09-30',
    });
    const ivanovice = (sport: SportId) => offering('sportcentrum-ivanovice', sport).source;
    assert.deepEqual(
      [ivanovice('badminton'), ivanovice('squash'), ivanovice('table-tennis')].map((s) =>
        s.type === 'memberpro' ? s.sportButton : undefined,
      ),
      [
        { name: 'BTN5', value: 'Badminton' },
        { name: 'BTN4', value: 'Squash' },
        { name: 'BTN3', value: 'Ping-pong' },
      ],
    );
    assert.deepEqual(offering('beach-riviera', 'beach-volleyball').source, {
      type: 'starez',
      url: 'https://beach.starez.cz/vstupenky-rezervace',
      facility: 'Beachvolejbal',
    });
    assert.equal(offering('beach-riviera', 'beach-volleyball').openingHours, undefined);
  });
});

describe('venue repository', () => {
  it('lists and finds records', () => {
    const repo = createVenueRepository(VENUE_RECORDS);
    assert.equal(repo.getAll().length, VENUE_RECORDS.length);
    assert.equal(repo.getById('hala-sprint')?.name, 'Hala Sprint');
    assert.equal(repo.getById('missing'), undefined);
  });

  it('getAll returns a copy', () => {
    const repo = createVenueRepository(VENUE_RECORDS);
    repo.getAll().length = 0;
    assert.equal(repo.getAll().length, VENUE_RECORDS.length);
  });

  it('toPublicVenue derives sports and never exposes a connector source', () => {
    for (const record of VENUE_RECORDS) {
      const venue = toPublicVenue(record);
      assert.ok(!('source' in venue));
      assert.equal(venue.id, record.id);
      assert.deepEqual(
        venue.sports,
        record.offerings.map((o) => o.sport),
      );
      assert.equal('phone' in venue, record.phone !== undefined);
      assert.equal('website' in venue, record.website !== undefined);
      assert.ok(!('otherActivities' in venue));
      record.offerings.forEach((o, i) => {
        const pub = venue.offerings[i];
        assert.ok(pub && !('source' in pub), `${record.id} ${o.sport}`);
        assert.equal(pub.availabilitySource, o.source.type);
        assert.equal('courts' in pub, o.courts !== undefined);
        assert.equal('pricing' in pub, o.pricing !== undefined);
        assert.equal('openingHours' in pub, o.openingHours !== undefined);
        assert.deepEqual(pub.pricing, o.pricing);
        assert.deepEqual(pub.multisport, o.multisport);
        if (pub.pricing && o.pricing) assert.notEqual(pub.pricing.rules[0], o.pricing.rules[0]);
        if ('limits' in o.multisport && o.multisport.limits) {
          assert.ok('limits' in pub.multisport && pub.multisport.limits);
          assert.notEqual(pub.multisport.limits, o.multisport.limits);
        }
      });
    }
  });

  it('toPublicOffering is a deep copy without the source', () => {
    const o = offering('centrum-viktoria', 'beach-volleyball');
    const pub = toPublicOffering(o);
    assert.ok(!('source' in pub));
    assert.deepEqual(pub.openingHours, o.openingHours);
    assert.notEqual(pub.openingHours, o.openingHours);
    assert.equal(pub.note, o.note);
  });
});
