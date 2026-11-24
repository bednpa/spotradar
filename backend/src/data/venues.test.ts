import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { WEEKDAYS, isValidTime } from '@spotradar/shared';
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
    assert.equal(byId.get('kuklenska')?.openingHours.approximate, true);
    assert.equal(byId.get('sportcentrum-ivanovice')?.courts, undefined);
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
    }
  });
});
