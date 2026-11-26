import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { VenueListItem } from '@spotradar/shared';
import { ApiRequestError } from './api.ts';
import {
  renderVenueCard,
  renderVenuesBody,
  renderVenuesControls,
  toVenueQuery,
  venueCountText,
  venuesErrorMessage,
  venuesFilterFromSearch,
  venuesFilterToSearch,
} from './venues-page.ts';
import type { VenuesFilter } from './venues-page.ts';
import { hours, makeOffering, makeVenue } from './test-fixtures.test.ts';

const NO_FILTER: VenuesFilter = { q: '', sport: null, sort: 'distance', cards: 0 };

const detailed: VenueListItem = {
  liveAvailability: true,
  liveSports: ['badminton'],
  venue: makeVenue('lisen', 'Badminton Líšeň', {
    district: 'Brno-Líšeň',
    website: 'https://www.example.com/lisen',
    pricing: {
      currency: 'CZK',
      unit: 'hour',
      rules: [
        { days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '07:00', to: '15:00', price: 280 },
        { days: ['sat', 'sun'], from: '08:00', to: '22:00', price: 400 },
      ],
      note: 'Students -20 %',
    },
    multisport: {
      category: 'half-per-card',
      limits: { maxPlayersPerCourt: 4 },
    },
    phone: '+420 123 456 789',
    openingHours: { ...hours('08:00', '22:00'), approximate: true },
  }),
};

const bare: VenueListItem = {
  liveAvailability: false,
  liveSports: [],
  venue: makeVenue('bare', 'Bare Hall', { courts: undefined }),
};

test('card shows name, district, address, sports, courts and price', () => {
  const html = renderVenueCard(detailed);
  assert.match(html, /<h3>Badminton Líšeň<\/h3>/);
  assert.match(html, /Brno-Líšeň · Badminton Líšeň street 1, Brno/);
  assert.match(html, /tag tag-sport tag-live" data-sport="badminton">.*🏸.*>Badminton</);
  assert.match(html, /<dt>Courts<\/dt><dd>4 courts<\/dd>/);
  assert.match(html, /<summary[^>]*>from 280 Kč \/ h<\/summary>/);
});

test('card price expands to the full table and note', () => {
  const html = renderVenueCard(detailed);
  assert.match(html, /<details class="price-details"/);
  assert.match(html, /<li><span class="hours-days">Fri<\/span> 07:00–15:00 280 Kč<\/li>/);
  assert.match(html, /<li><span class="hours-days">Sat<\/span> 08:00–22:00 400 Kč<\/li>/);
  assert.match(html, /<li><span class="hours-days">Sun<\/span> 08:00–22:00 400 Kč<\/li>/);
  assert.doesNotMatch(html, /Mon–Fri|Sat, Sun/);
  assert.match(html, /Students -20 %/);
});

test('card lists opening hours for all 7 days and never says "approximate"', () => {
  const html = renderVenueCard(detailed);
  for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
    assert.match(html, new RegExp(`<span class="hours-days">${day}</span> 08:00–22:00`));
  }
  assert.doesNotMatch(html, /approximate|Mon–Sun/);
});

test('card does not show the booking system, a phone number or unsupported activities', () => {
  const html = renderVenueCard(detailed);
  assert.doesNotMatch(html, /<dt>Booking<\/dt>|ClubSpire|Bizzy/);
  assert.doesNotMatch(html, /tel:|123 456 789/);
  assert.match(html, /aria-label="Sports">/);
});

test('card shows the MultiSport label with note, and unknown when absent', () => {
  assert.match(renderVenueCard(detailed), />1 card = 50 % off</);
  assert.match(renderVenueCard(detailed), /title="max 4 players per court"/);
  assert.match(
    renderVenueCard(bare),
    /<dt>MultiSport<\/dt><dd><span class="badge[^>]*>MultiSport: not available</,
  );
  const not = renderVenueCard({
    ...bare,
    venue: makeVenue('bare', 'Bare Hall', { multisport: { category: 'not-accepted' } }),
  });
  assert.match(not, />No MultiSport</);
});

test('card links: website, booking and Google Maps rating link; live badge', () => {
  const html = renderVenueCard(detailed);
  assert.match(
    html,
    /href="https:\/\/www\.example\.com\/lisen"[^>]*rel="noopener noreferrer">Website/,
  );
  assert.match(
    html,
    /href="https:\/\/example\.com\/lisen"[^>]*>Book badminton<span class="visually-hidden"> at Badminton Líšeň<\/span> on venue's website/,
  );
  assert.match(html, /google\.com\/maps\/search[^"]*"[^>]*>Rating &amp; reviews on Google Maps/);
  assert.match(html, /class="live-status live-status-live"[^>]*data-status="live"/);
  assert.match(html, />Live</);
  assert.match(html, /data-live="true"/);

  const plain = renderVenueCard(bare);
  assert.doesNotMatch(plain, />Website|tel:|live-status-live/);
  assert.match(plain, /live-status-unknown/);
  assert.match(plain, />Check on website</);
  assert.match(plain, /data-live="false"/);
  assert.match(plain, /<dt>Price<\/dt><dd><span class="muted"[^>]*>Price on website</);
});

test('card drops unsafe links', () => {
  const html = renderVenueCard({
    liveAvailability: false,
    liveSports: [],
    venue: makeVenue('x', 'X', {
      website: 'javascript:alert(1)',
      bookingUrl: 'javascript:alert(2)',
      phone: 'call me',
    }),
  });
  assert.doesNotMatch(html, /javascript:|tel:/);
});

test('body renders the loading skeleton, error with retry and the empty state', () => {
  const filter: VenuesFilter = { q: 'zzz <x>', sport: null, sort: 'distance', cards: 0 };
  assert.match(renderVenuesBody({ status: 'loading' }, filter), /class="skeleton skeleton-card"/);
  const error = renderVenuesBody({ status: 'error', message: 'Boom' }, filter);
  assert.match(error, /role="alert"/);
  assert.match(error, /data-action="retry-venues">Try again</);
  const empty = renderVenuesBody(
    { status: 'success', data: { query: { q: 'zzz' }, venues: [] } },
    filter,
  );
  assert.match(empty, /No venues match “zzz &lt;x&gt;”/);
  assert.match(empty, /data-action="clear-venue-filters"/);
  const unfiltered = renderVenuesBody(
    { status: 'success', data: { query: {}, venues: [] } },
    NO_FILTER,
  );
  assert.doesNotMatch(unfiltered, /clear-venue-filters/);
});

test('body lists cards with a result count', () => {
  const html = renderVenuesBody(
    { status: 'success', data: { query: {}, venues: [detailed, bare] } },
    NO_FILTER,
  );
  assert.match(html, /role="status">2 venues</);
  assert.equal((html.match(/class="vcard"/g) ?? []).length, 2);
  assert.equal(venueCountText(1), '1 venue');
  assert.equal(venueCountText(0), 'No venues');
});

test('controls: labelled search box and sport chips', () => {
  const html = renderVenuesControls({ ...NO_FILTER, q: 'li"sen', sport: 'badminton' });
  assert.match(html, /<label for="venue-search">Search venues<\/label>/);
  assert.match(html, /type="search"[^>]*value="li&quot;sen"/);
  assert.match(html, /data-venue-sport="" aria-pressed="false">All sports</);
  assert.match(html, /data-venue-sport="badminton" aria-pressed="true"[^>]*>.*>Badminton</);
  // every sport has a chip with its icon (decorative) and the Czech name as tooltip
  for (const id of [
    'tennis',
    'squash',
    'padel',
    'table-tennis',
    'volleyball',
    'beach-volleyball',
  ]) {
    assert.match(html, new RegExp(`data-venue-sport="${id}" aria-pressed="false"`));
  }
  assert.match(
    html,
    /class="sport-icon" aria-hidden="true">🏓<\/span> <span title="Stolní tenis">Table tennis</,
  );
});

test('URL state and API query', () => {
  assert.deepEqual(venuesFilterFromSearch('?q=%20lisen%20&sport=badminton'), {
    ...NO_FILTER,
    q: 'lisen',
    sport: 'badminton',
  });
  assert.deepEqual(venuesFilterFromSearch('?sport=golf'), NO_FILTER);
  assert.equal(venuesFilterFromSearch('?sport=table-tennis').sport, 'table-tennis');
  assert.equal(
    venuesFilterToSearch({ ...NO_FILTER, sport: 'beach-volleyball' }),
    'sport=beach-volleyball',
  );
  assert.equal(venuesFilterFromSearch(`?q=${'x'.repeat(300)}`).q.length, 100);
  assert.equal(
    venuesFilterToSearch({ ...NO_FILTER, q: 'a b', sport: 'badminton' }),
    'q=a+b&sport=badminton',
  );
  assert.equal(venuesFilterToSearch({ ...NO_FILTER, q: ' ' }), '');
  assert.deepEqual(toVenueQuery({ ...NO_FILTER, q: ' lisen ' }), { q: 'lisen' });
  assert.deepEqual(toVenueQuery({ ...NO_FILTER, sport: 'badminton' }), { sport: 'badminton' });
  assert.deepEqual(toVenueQuery(NO_FILTER), {});
});

test('URL state round-trips sort and cards (omitted when default, invalid → default)', () => {
  const filter: VenuesFilter = { ...NO_FILTER, sort: 'price', cards: 3 };
  assert.equal(venuesFilterToSearch(filter), 'sort=price&cards=3');
  assert.deepEqual(venuesFilterFromSearch('?sort=price&cards=3'), filter);
  assert.deepEqual(venuesFilterFromSearch('?sort=x&cards=7'), NO_FILTER);
  // sort and cards never reach the API query
  assert.deepEqual(toVenueQuery(filter), {});
});

test('controls render the Sort by and MultiSport cards groups', () => {
  const html = renderVenuesControls({ ...NO_FILTER, sort: 'price', cards: 2 });
  assert.match(html, /role="group" aria-labelledby="venues-sort-label"/);
  assert.match(html, /id="venues-sort-label">Sort by</);
  assert.match(html, /data-sort-mode="distance"[^>]*aria-pressed="false">Distance</);
  assert.match(html, /data-sort-mode="price"[^>]*aria-pressed="true">Price</);
  assert.match(html, /id="venues-cards-label">MultiSport cards</);
  assert.match(html, /data-cards-count="2"[^>]*aria-pressed="true">2</);
  assert.match(html, /data-cards-count="0"[^>]*aria-pressed="false">0</);
});

function cardOrder(html: string): string[] {
  return [...html.matchAll(/class="vcard" data-venue-id="([^"]+)"/g)].map((m) => m[1] ?? '');
}

function item(id: string, name: string, lat: number, price?: number): VenueListItem {
  return {
    liveAvailability: false,
    liveSports: [],
    venue: makeVenue(id, name, {
      location: { lat, lng: 16.6 },
      multisport: { category: 'half-per-card' },
      ...(price === undefined
        ? {}
        : {
            pricing: {
              currency: 'CZK' as const,
              unit: 'hour' as const,
              rules: [{ days: ['mon' as const], from: '07:00', to: '22:00', price }],
            },
          }),
    }),
  };
}

test('venues page sorts by distance from the origin, by price with the cards, unknown last', () => {
  // the API returns the name order: Alfa (far), Beta (near, 400), Gama (middle, 200), Delta (no price)
  const items = [
    item('alfa', 'Alfa', 49.4, 300),
    item('beta', 'Beta', 49.2, 400),
    item('gama', 'Gama', 49.3, 200),
    item('delta', 'Delta', 49.25),
  ];
  const state = { status: 'success' as const, data: { query: {}, venues: items } };
  const origin = { lat: 49.2, lng: 16.6 };

  // no location: distance keeps the API order
  assert.deepEqual(cardOrder(renderVenuesBody(state, NO_FILTER)), [
    'alfa',
    'beta',
    'gama',
    'delta',
  ]);
  // with a location: nearest first
  const near = renderVenuesBody(state, NO_FILTER, origin);
  assert.deepEqual(cardOrder(near), ['beta', 'delta', 'gama', 'alfa']);
  assert.match(near, /0\.0 km away/);

  const byPrice = { ...NO_FILTER, sort: 'price' as const };
  assert.deepEqual(cardOrder(renderVenuesBody(state, byPrice, origin)), [
    'gama',
    'alfa',
    'beta',
    'delta',
  ]);
  // 2 cards halve... both cards used: 400 -> 0 and 300 -> 0 ... payable 0 for all priced ones;
  // ties by distance: beta (nearest), gama, alfa
  const twoCards = { ...byPrice, cards: 2 as const };
  const html = renderVenuesBody(state, twoCards, origin);
  assert.deepEqual(cardOrder(html), ['beta', 'gama', 'alfa', 'delta']);
  assert.match(html, />from 400 Kč → 0 Kč \/ h</);
  // one card: 400 -> 200, 300 -> 150, 200 -> 100
  const oneCard = renderVenuesBody(state, { ...byPrice, cards: 1 }, origin);
  assert.deepEqual(cardOrder(oneCard), ['gama', 'alfa', 'beta', 'delta']);
  assert.match(oneCard, />from 200 Kč → 100 Kč \/ h</);
});

const multi: VenueListItem = {
  liveAvailability: true,
  liveSports: ['squash'],
  venue: makeVenue('viktoria', 'Centrum Viktoria', {
    offerings: [
      makeOffering('viktoria', { sport: 'squash', courts: 6, note: 'Indoor <courts>' }),
      makeOffering('viktoria', {
        sport: 'beach-volleyball',
        courts: 5,
        bookingSystem: 'clubspire',
        openingHours: { ...hours('07:00', '22:00'), season: { from: '05-01', to: '09-30' } },
      }),
      makeOffering('viktoria', {
        sport: 'tennis',
        courts: 1,
        openingHours: undefined,
        bookingSystem: 'phone',
        availabilitySource: 'none',
        bookingUrl: 'https://example.com/viktoria-tennis',
      }),
    ],
  }),
};

test('card without a sport filter: one section per sport with its own details', () => {
  const html = renderVenueCard(multi, 0, undefined, null, '2026-11-25');
  assert.equal((html.match(/<div class="offering" role="group"/g) ?? []).length, 3);
  assert.doesNotMatch(html, /<section/); // no extra landmarks per sport
  assert.match(html, /data-sport="squash" aria-label="Squash"/);
  // tags with icons; only squash is live
  assert.match(html, /tag tag-sport tag-live" data-sport="squash"/);
  assert.match(html, /tag tag-sport" data-sport="tennis"/);
  assert.match(html, /<dt>Courts<\/dt><dd>6 courts<\/dd>/);
  assert.match(html, /Indoor &lt;courts&gt;/);
  // season, out of season today
  assert.match(
    html,
    /Season 1 May – 30 Sep · <span class="badge badge-neutral">Closed out of season/,
  );
  // unknown hours; the booking system is never shown
  assert.match(html, /Opening hours not available/);
  assert.doesNotMatch(html, /<dt>Booking<\/dt>|Phone \/ e-mail/);
  assert.match(
    html,
    /href="https:\/\/example\.com\/viktoria-tennis"[^>]*>Book tennis<span class="visually-hidden"> at Centrum Viktoria<\/span> on venue's website/,
  );
  // in season: no "closed" badge
  const summer = renderVenueCard(multi, 0, undefined, null, '2026-06-10');
  assert.doesNotMatch(summer, /Closed out of season/);
});

test('card with a sport filter shows only that sport', () => {
  const html = renderVenueCard(multi, 0, undefined, 'tennis', '2026-11-25');
  assert.equal((html.match(/<div class="offering" role="group"/g) ?? []).length, 1);
  assert.match(html, /data-sport="tennis" aria-label="Tennis"/);
  // all sports of the venue are still listed as tags
  assert.match(html, /data-sport="beach-volleyball">/);
});

test('empty state for a sport without venues', () => {
  const html = renderVenuesBody(
    { status: 'success', data: { query: { sport: 'volleyball' }, venues: [] } },
    { ...NO_FILTER, sport: 'volleyball' },
  );
  assert.match(html, /No volleyball venues in SpotRadar yet/);
  assert.match(html, /data-action="clear-venue-filters">Show all sports</);
});

test('error messages', () => {
  assert.match(venuesErrorMessage(new ApiRequestError(400, 'VALIDATION_ERROR', 'x')), /not valid/);
  assert.equal(venuesErrorMessage(new ApiRequestError(500, 'INTERNAL_ERROR', 'Boom')), 'Boom');
  assert.match(venuesErrorMessage(new Error('x')), /Something went wrong/);
});
