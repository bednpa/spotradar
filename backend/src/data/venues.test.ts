import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  WEEKDAYS,
  courtPrice,
  isValidTime,
  priceFor,
  timeToMinutes,
  validateMultisport,
  validatePricing,
} from '@spotradar/shared';
import { createVenueRepository, toPublicVenue } from '../repositories/venueRepository.ts';
import { VENUE_RECORDS } from './venues.ts';

describe('venue data', () => {
  it('lists the seven expected venues with unique ids', () => {
    const ids = VENUE_RECORDS.map((v) => v.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(ids.toSorted(), [
      'badminton-jehnice',
      'badminton-lisen',
      'centrum-viktoria',
      'hala-sprint',
      'kuklenska',
      'sportcentrum-ivanovice',
      'x-arena-slatina',
    ]);
  });

  it('has coordinates inside Brno and non-empty texts', () => {
    for (const v of VENUE_RECORDS) {
      assert.ok(v.location.lat > 49.0 && v.location.lat < 49.4, `${v.id} lat`);
      assert.ok(v.location.lng > 16.4 && v.location.lng < 16.8, `${v.id} lng`);
      assert.ok(v.name !== '' && v.district.startsWith('Brno-') && v.address.endsWith(', Brno'));
      assert.deepEqual(v.sports, ['badminton']);
    }
  });

  it('keeps availabilitySource equal to source.type', () => {
    for (const v of VENUE_RECORDS) assert.equal(v.availabilitySource, v.source.type, v.id);
  });

  it('uses valid http(s) URLs and ClubSpire booking URLs derived from the source', () => {
    for (const v of VENUE_RECORDS) {
      assert.match(v.bookingUrl, /^https?:\/\//, v.id);
      assert.doesNotThrow(() => new URL(v.bookingUrl));
      if (v.source.type === 'clubspire') {
        assert.equal(v.bookingUrl, `${v.source.baseUrl}timeline/day?tabIdx=${v.source.tabIdx}`);
      } else if (v.source.type === 'bizzy') {
        assert.equal(v.bookingUrl, v.source.scheduleUrl);
      } else if (v.source.type === 'memberzone' || v.source.type === 'memberpro') {
        assert.equal(v.bookingUrl, v.source.url);
      }
    }
  });

  it('has website, price info and consistent Multisport / activity details', () => {
    for (const v of VENUE_RECORDS) {
      assert.ok(v.website, `${v.id} website`);
      assert.match(v.website, /^https?:\/\//, v.id);
      assert.doesNotThrow(() => new URL(v.website ?? ''));
      assert.ok(v.pricing, `${v.id} pricing`);
      assert.deepEqual(validateMultisport(v.multisport), [], `${v.id} multisport`);
      if (v.otherActivities) {
        assert.ok(v.otherActivities.length > 0, v.id);
        assert.ok(
          v.otherActivities.every((a) => a.trim() !== ''),
          v.id,
        );
      }
    }
  });

  it('has valid, non-overlapping pricing that covers every open hour', () => {
    for (const v of VENUE_RECORDS) {
      assert.ok(v.pricing, v.id);
      assert.deepEqual(validatePricing(v.pricing), [], v.id);
      for (const r of v.pricing.rules) {
        for (const day of r.days) {
          const hours = v.openingHours.days[day];
          assert.ok(hours, `${v.id} ${day} open`);
          assert.ok(timeToMinutes(r.from) >= timeToMinutes(hours.open), `${v.id} ${day} from`);
          assert.ok(timeToMinutes(r.to) <= timeToMinutes(hours.close), `${v.id} ${day} to`);
        }
      }
      // 2026-11-23 is a Monday.
      WEEKDAYS.forEach((day, i) => {
        const date = `2026-11-${String(23 + i).padStart(2, '0')}`;
        const hours = v.openingHours.days[day];
        assert.ok(hours, `${v.id} ${day}`);
        const first = timeToMinutes(hours.open) / 60;
        const last = timeToMinutes(hours.close) / 60;
        for (let h = first; h < last; h++) {
          assert.notEqual(priceFor(v.pricing, date, h), null, `${v.id} ${day} ${h}:00`);
        }
        assert.equal(priceFor(v.pricing, date, last), null, `${v.id} ${day} after close`);
      });
    }
  });

  it('spot-checks concrete prices', () => {
    const byId = new Map(VENUE_RECORDS.map((v) => [v.id, v]));
    const price = (id: string, date: string, time: number | string) =>
      priceFor(byId.get(id)?.pricing, date, time);
    assert.equal(price('kuklenska', '2026-11-25', 14), 280); // Wed
    assert.equal(price('kuklenska', '2026-11-25', '15:00'), 380);
    assert.equal(price('kuklenska', '2026-11-28', 10), 330); // Sat before 15:00
    assert.equal(price('kuklenska', '2026-11-28', 8), 330);
    assert.equal(price('kuklenska', '2026-11-28', 14), 330);
    assert.equal(price('kuklenska', '2026-11-28', 15), 380);
    assert.equal(price('kuklenska', '2026-11-29', 20), 380); // Sun
    assert.equal(price('kuklenska', '2026-11-29', 21), null); // closed
    assert.equal(price('badminton-jehnice', '2026-11-25', 16), 240);
    assert.equal(price('badminton-jehnice', '2026-11-25', 17), 290);
    assert.equal(price('badminton-jehnice', '2026-11-28', 7), 290);
    assert.equal(price('badminton-jehnice', '2026-11-25', 10), null); // closed
    assert.equal(price('sportcentrum-ivanovice', '2026-11-26', 21), 440); // Thu
    assert.equal(price('sportcentrum-ivanovice', '2026-11-27', 20), 440); // Fri
    assert.equal(price('sportcentrum-ivanovice', '2026-11-27', 21), null); // Fri closed
  });

  it('describes MultiSport terms per venue', () => {
    const byId = new Map(VENUE_RECORDS.map((v) => [v.id, v]));
    const ms = (id: string) => byId.get(id)?.multisport;
    assert.deepEqual(ms('kuklenska'), { category: 'half-per-card' });
    assert.deepEqual(ms('centrum-viktoria'), { category: 'minutes-per-card', minutesPerCard: 30 });
    assert.deepEqual(ms('badminton-jehnice'), { category: 'unknown' });
    assert.deepEqual(ms('badminton-lisen'), { category: 'half-per-card' });
    assert.deepEqual(ms('x-arena-slatina'), {
      category: 'half-per-card',
      limits: { maxPlayersPerCourt: 4 },
    });
    assert.deepEqual(ms('hala-sprint'), { category: 'unknown' });
    assert.deepEqual(ms('sportcentrum-ivanovice'), {
      category: 'full-two-cards',
      limits: { maxCardsPerCourt: 2, onlyBookingMinutes: 60, requiresNotice: true },
      note: 'One sports activity per card per day',
    });
  });

  it('computes court prices with MultiSport cards on real data', () => {
    const byId = new Map(VENUE_RECORDS.map((v) => [v.id, v]));
    const at = (id: string, date: string, hour: number, cards: number) => {
      const v = byId.get(id);
      return courtPrice({ pricing: v?.pricing, multisport: v?.multisport, date, hour, cards });
    };
    // Ivanovice: 2 cards pay the whole court (440 Kč Wed evening).
    assert.deepEqual(at('sportcentrum-ivanovice', '2026-11-25', 18, 2), {
      basePrice: 440,
      cardsUsed: 2,
      payable: 0,
    });
    // More cards than the venue accepts are ignored.
    assert.equal(at('sportcentrum-ivanovice', '2026-11-25', 18, 4)?.cardsUsed, 2);
    // X-Arena: 4 cards requested, half-per-card makes only 2 useful.
    assert.deepEqual(at('x-arena-slatina', '2026-11-25', 18, 4), {
      basePrice: 400,
      cardsUsed: 2,
      payable: 0,
    });
    // Kuklenská weekend morning: 330 Kč, 1 card = half.
    assert.deepEqual(at('kuklenska', '2026-11-28', 10, 1), {
      basePrice: 330,
      cardsUsed: 1,
      payable: 165,
    });
    // Viktoria: 1 card = 30 min of 400 Kč.
    assert.deepEqual(at('centrum-viktoria', '2026-11-25', 18, 1), {
      basePrice: 400,
      cardsUsed: 1,
      payable: 200,
    });
    // Unknown terms: cards are never applied.
    assert.deepEqual(at('hala-sprint', '2026-11-25', 18, 2), {
      basePrice: 380,
      cardsUsed: 0,
      payable: 380,
    });
  });

  it('has HH:MM opening hours with open before close for every day', () => {
    for (const v of VENUE_RECORDS) {
      for (const day of WEEKDAYS) {
        const hours = v.openingHours.days[day];
        assert.ok(hours, `${v.id} ${day}`);
        assert.ok(isValidTime(hours.open) && isValidTime(hours.close), `${v.id} ${day}`);
        assert.ok(hours.open < hours.close, `${v.id} ${day}`);
      }
    }
  });

  it('matches the researched values of individual venues', () => {
    const byId = new Map(VENUE_RECORDS.map((v) => [v.id, v]));
    const viktoria = byId.get('centrum-viktoria');
    assert.equal(viktoria?.courts, 3);
    assert.equal(viktoria?.openingHours.approximate, false);
    assert.deepEqual(viktoria?.openingHours.days.sat, { open: '08:00', close: '22:00' });
    assert.deepEqual(viktoria?.openingHours.days.mon, { open: '07:00', close: '22:00' });
    assert.deepEqual(byId.get('badminton-jehnice')?.openingHours.days.tue, {
      open: '14:00',
      close: '22:00',
    });
    assert.equal(byId.get('kuklenska')?.openingHours.approximate, false);
    assert.deepEqual(byId.get('kuklenska')?.openingHours.days.sun, {
      open: '08:00',
      close: '21:00',
    });
    assert.equal(byId.get('badminton-lisen')?.openingHours.approximate, true);
    assert.equal(byId.get('badminton-jehnice')?.address, 'Blanenská 3a, Brno');
    const ivanovice = byId.get('sportcentrum-ivanovice')?.openingHours;
    assert.deepEqual(ivanovice?.days.thu, { open: '07:00', close: '22:00' });
    assert.deepEqual(ivanovice?.days.fri, { open: '07:00', close: '21:00' });
    assert.deepEqual(ivanovice?.days.sat, { open: '08:00', close: '21:00' });
    assert.deepEqual(byId.get('kuklenska')?.otherActivities, undefined);
    assert.deepEqual(byId.get('x-arena-slatina')?.otherActivities, ['Table tennis']);
    assert.equal(
      byId.get('kuklenska')?.bookingUrl,
      'https://kuklenska.clubspire.cz/timeline/day?tabIdx=0',
    );
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

  it('toPublicVenue never exposes the connector source', () => {
    for (const record of VENUE_RECORDS) {
      const venue = toPublicVenue(record);
      assert.ok(!('source' in venue));
      assert.equal(venue.id, record.id);
      assert.equal(venue.availabilitySource, record.source.type);
      assert.equal('courts' in venue, record.courts !== undefined);
      assert.equal('phone' in venue, record.phone !== undefined);
      assert.equal('website' in venue, record.website !== undefined);
      assert.equal('pricing' in venue, record.pricing !== undefined);
      assert.ok(!('priceInfo' in venue));
      assert.deepEqual(venue.pricing, record.pricing);
      assert.deepEqual(venue.multisport, record.multisport);
      if (venue.pricing && record.pricing) {
        assert.notEqual(venue.pricing.rules[0], record.pricing.rules[0]);
      }
      assert.ok('multisport' in venue);
      if ('limits' in record.multisport && record.multisport.limits) {
        assert.ok('limits' in venue.multisport && venue.multisport.limits);
        assert.notEqual(venue.multisport.limits, record.multisport.limits);
      }
      assert.equal('otherActivities' in venue, record.otherActivities !== undefined);
    }
  });
});
