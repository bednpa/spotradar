import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPanel } from './panel.ts';
import type { SportOffering } from '@spotradar/shared';
import { NOW, live, makeCalendar, makeVenue } from './test-fixtures.test.ts';

const data = makeCalendar('2026-11-25', '2026-11-27');

function order(html: string): string[] {
  return [...html.matchAll(/data-state="(\w+)" data-venue-id="(\w+)"/g)].map(
    (m) => `${m[2]}:${m[1]}`,
  );
}

test('lists free venues first, check venues in a collapsed section; full and closed are omitted', () => {
  const html = renderPanel({ date: '2026-11-26', hour: 18, data, now: NOW });
  assert.deepEqual(order(html), ['kuklenska:free', 'viktoria:check', 'unknown:check']);
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-labelledby="detail-title"/);
  assert.match(html, /<h2 id="detail-title">18:00–19:00<\/h2>/);
  assert.match(html, /Thursday 26 November/);
  assert.match(html, /1 court free/);
  assert.doesNotMatch(html, /Fully booked/);
  assert.doesNotMatch(html, /data-venue-id="full"|data-venue-id="closed"/);
  assert.match(html, /<details class="check-venues">/);
  assert.match(html, /2 venues without live data – check on website/);
  assert.match(html, /live-status-unavailable[^>]*>.*Unavailable/);
  assert.match(html, /live-status-unknown[^>]*>.*Check on website/);
  assert.match(html, /aria-label="Close details"/);
  assert.doesNotMatch(html, /No badminton venue is free/);

  const links = [
    ...html.matchAll(
      /<a class="btn btn-primary" href="([^"]+)" target="_blank" rel="noopener noreferrer">/g,
    ),
  ];
  assert.deepEqual(
    links.map((m) => m[1]),
    [
      'https://example.com/kuklenska',
      'https://example.com/viktoria',
      'https://example.com/unknown',
    ],
  );
  assert.match(html, /Book on venue's website/);
});

test('live status is one "Live · x min ago" line with the absolute time in the title', () => {
  // data was checked at 11:57Z, NOW is 11:00Z -> in the future -> "just now"
  const html0 = renderPanel({ date: '2026-11-26', hour: 18, data, now: NOW });
  assert.match(html0, /title="Live availability, checked at 12:57"/);
  assert.match(html0, />Live · just now</);
  const later = new Date('2026-11-25T12:02:00Z');
  const html = renderPanel({ date: '2026-11-26', hour: 18, data, now: later });
  assert.match(html, />Live · 5 min ago</);
  const hours = renderPanel({
    date: '2026-11-26',
    hour: 18,
    data,
    now: new Date('2026-11-25T14:00:00Z'),
  });
  assert.match(hours, />Live · 2 h ago</);
});

test('every venue row shows one slot price; cards recompute it and name the cards used', () => {
  const evening = renderPanel({ date: '2026-11-26', hour: 18, data, now: NOW });
  // one row per venue (free + check), each with exactly one price and one badge
  assert.equal((evening.match(/data-testid="slot-price"/g) ?? []).length, 3);
  assert.equal((evening.match(/data-testid="multisport"/g) ?? []).length, 3);
  assert.match(evening, /data-testid="slot-price">380 Kč \/ h</);
  assert.doesNotMatch(evening, /slot-price-cards|With card|with MultiSport/);
  // Morning slot (08:00) falls into the first price rule.
  const morning = renderPanel({ date: '2026-11-26', hour: 8, data, now: NOW, cards: 1 });
  assert.match(morning, /data-testid="slot-price">280 Kč → 140 Kč</);
  assert.match(morning, /data-testid="slot-price-cards">with 1 card</);
  const two = renderPanel({ date: '2026-11-26', hour: 18, data, now: NOW, cards: 2 });
  assert.match(two, /data-testid="slot-price">380 Kč → 0 Kč</);
  assert.match(two, /with 2 cards</);
  // venues without a known price / MultiSport terms are unchanged by the cards
  assert.equal((two.match(/Price on website/g) ?? []).length, 2);
  assert.equal((two.match(/data-testid="slot-price-cards"/g) ?? []).length, 1);
});

test('unknown price and MultiSport are labelled, not hidden', () => {
  const plain = makeCalendar('2026-11-25', '2026-11-27', [
    { venue: makeVenue('kuklenska', 'Plain Hall') },
  ]);
  const html = renderPanel({ date: '2026-11-26', hour: 18, data: plain, now: NOW, cards: 2 });
  assert.match(html, /data-testid="slot-price">Price on website</);
  assert.match(html, />MultiSport: not available</);
  assert.doesNotMatch(html, /slot-price-cards|multisport-limits/);
});

test('"No MultiSport" venues keep the price with cards; limits are a tooltip and visible text', () => {
  const priced = (price: number): SportOffering['pricing'] => ({
    currency: 'CZK',
    unit: 'hour',
    rules: [
      {
        days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
        from: '00:00',
        to: '24:00',
        price,
      },
    ],
  });
  const cal = makeCalendar('2026-11-25', '2026-11-27', [
    {
      venue: makeVenue('kuklenska', 'No Card Hall', {
        pricing: priced(400),
        multisport: { category: 'not-accepted' },
      }),
    },
    {
      venue: makeVenue('viktoria', 'Limits Hall', {
        pricing: priced(400),
        multisport: {
          category: 'half-per-card',
          limits: { maxPlayersPerCourt: 4, onlyBookingMinutes: 60 },
        },
      }),
    },
  ]);
  const html = renderPanel({ date: '2026-11-26', hour: 18, data: cal, now: NOW, cards: 2 });
  assert.match(html, /badge-neutral"[^>]*data-testid="multisport">No MultiSport</);
  assert.match(html, /data-testid="slot-price">400 Kč \/ h</);
  // two cards cover half each: the court is free, 2 cards are used (4 players allowed)
  assert.match(html, /data-testid="slot-price">400 Kč → 0 Kč</);
  assert.match(html, /title="max 4 players per court · 60-min bookings only"/);
  assert.match(
    html,
    /data-testid="multisport-limits">max 4 players per court · 60-min bookings only</,
  );
  assert.equal((html.match(/data-testid="multisport-limits"/g) ?? []).length, 1);
});

test('free and check lists are sorted separately by distance (default) and by slot price', () => {
  const priced = (price: number): SportOffering['pricing'] => ({
    currency: 'CZK',
    unit: 'hour',
    rules: [
      {
        days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
        from: '00:00',
        to: '24:00',
        price,
      },
    ],
  });
  const venues = [
    // free (live with free slot at 18:00): cheap but far, dear but near
    { venue: makeVenue('kuklenska', 'Far Cheap', { pricing: priced(200) }), distanceKm: 5 },
    { venue: makeVenue('near', 'Near Dear', { pricing: priced(500) }), distanceKm: 1 },
    // check (unavailable / unknown)
    { venue: makeVenue('viktoria', 'Check Far', { pricing: priced(100) }), distanceKm: 4 },
    { venue: makeVenue('unknown', 'Check Near No Price'), distanceKm: 2 },
  ];
  const cal = makeCalendar('2026-11-25', '2026-11-27', venues);
  for (const day of cal.days) {
    day.venues.push({ venueId: 'near', availability: live() });
  }
  const byDistance = renderPanel({ date: '2026-11-26', hour: 18, data: cal, now: NOW });
  assert.deepEqual(order(byDistance), [
    'near:free',
    'kuklenska:free',
    'unknown:check',
    'viktoria:check',
  ]);
  const byPrice = renderPanel({
    date: '2026-11-26',
    hour: 18,
    data: cal,
    now: NOW,
    sort: 'price',
  });
  assert.deepEqual(order(byPrice), [
    'kuklenska:free',
    'near:free',
    'viktoria:check',
    'unknown:check',
  ]);
  assert.match(byPrice, /data-sort-mode="price"[^>]*aria-pressed="true"/);
  assert.match(byPrice, /<details class="check-venues">/);
  // an opened "check" section stays open when the panel is re-rendered
  const reopened = renderPanel({
    date: '2026-11-26',
    hour: 18,
    data: cal,
    now: NOW,
    sort: 'price',
    checkOpen: true,
  });
  assert.match(reopened, /<details class="check-venues" open>/);

  // cards re-sort: with 2 cards the dear venue accepting MultiSport becomes the cheapest
  const withCards = makeCalendar('2026-11-25', '2026-11-27', [
    venues[0] as (typeof venues)[number],
    {
      venue: makeVenue('near', 'Near Dear', {
        pricing: priced(500),
        multisport: { category: 'half-per-card' },
      }),
      distanceKm: 1,
    },
  ]);
  for (const day of withCards.days) day.venues.push({ venueId: 'near', availability: live() });
  const free = (cards: 0 | 2): string[] =>
    order(
      renderPanel({
        date: '2026-11-26',
        hour: 18,
        data: withCards,
        now: NOW,
        sort: 'price',
        cards,
      }),
    );
  assert.deepEqual(free(0), ['kuklenska:free', 'near:free']);
  assert.deepEqual(free(2), ['near:free', 'kuklenska:free']);
});

test('the panel has the Sort by and MultiSport cards controls above the lists', () => {
  const html = renderPanel({ date: '2026-11-26', hour: 18, data, now: NOW, cards: 3 });
  assert.match(html, /role="group" aria-labelledby="panel-sort-label"/);
  assert.match(html, /data-sort-mode="distance"[^>]*aria-pressed="true">Distance</);
  assert.match(html, /data-cards-count="3"[^>]*aria-pressed="true">3</);
  assert.ok(html.indexOf('panel-sort-label') < html.indexOf('class="venue-items"'));
  // no controls when there is nothing to sort
  const closed = renderPanel({ date: '2026-11-26', hour: 5, data, now: NOW });
  assert.doesNotMatch(closed, /data-sort-mode/);
});

test('free venues show MultiSport, website and Google Maps links', () => {
  const html = renderPanel({ date: '2026-11-26', hour: 18, data, now: NOW });
  assert.match(html, />1 card = 50 % off</);
  assert.match(html, /href="https:\/\/www\.example\.com\/kuklenska"[^>]*>Website/);
  assert.match(html, /href="https:\/\/www\.google\.com\/maps\/search\/\?api=1&amp;query=/);
  assert.match(html, /Rating &amp; reviews on Google Maps/);
});

test('a venue without a website omits the link', () => {
  const plain = makeCalendar('2026-11-25', '2026-11-27', [
    { venue: makeVenue('kuklenska', 'Plain Hall') },
  ]);
  const html = renderPanel({ date: '2026-11-26', hour: 18, data: plain, now: NOW });
  assert.doesNotMatch(html, />Website/);
  assert.match(html, /Rating &amp; reviews on Google Maps/);
});

test('empty state when nothing is free still lists check venues (section open)', () => {
  const html = renderPanel({ date: '2026-11-26', hour: 12, data, now: NOW });
  assert.match(html, /No badminton venue is free at 12:00–13:00/);
  assert.match(html, /check their websites/);
  assert.match(html, /<details class="check-venues" open>/);
  assert.deepEqual(order(html), ['viktoria:check', 'unknown:check']);
  assert.equal((html.match(/Book on venue's website/g) ?? []).length, 2);
});

test('empty state when every venue is closed', () => {
  const html = renderPanel({ date: '2026-11-26', hour: 5, data, now: NOW });
  assert.match(html, /No badminton venue is free at 05:00–06:00/);
  assert.match(html, /Try another hour or day/);
  assert.doesNotMatch(html, /Book on venue's website|<details/);
});

test('distance is shown when known and unsafe links are dropped', () => {
  const html = renderPanel({ date: '2026-11-26', hour: 18, data, now: NOW });
  assert.match(html, /1\.5 km away/);

  const bad = makeCalendar('2026-11-25', '2026-11-27', [
    {
      venue: makeVenue('kuklenska', 'Evil <Hall>', {
        bookingUrl: 'javascript:alert(1)',
        website: 'javascript:alert(2)',
      }),
    },
  ]);
  const unsafe = renderPanel({ date: '2026-11-26', hour: 18, data: bad, now: NOW });
  assert.doesNotMatch(unsafe, /javascript:/);
  assert.match(unsafe, /Evil &lt;Hall&gt;/);
});
