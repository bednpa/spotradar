import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPanel } from './panel.ts';
import { NOW, makeCalendar, makeVenue } from './test-fixtures.test.ts';

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
  assert.match(html, /Couldn(&#39;|')t read availability right now/);
  assert.match(html, /No live data for this venue/);
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

test('live check is shown as "x minutes ago" with the absolute time in the title', () => {
  // data was checked at 11:57Z, NOW is 11:00Z -> in the future -> "just now"
  assert.match(
    renderPanel({ date: '2026-11-26', hour: 18, data, now: NOW }),
    /Checked <time datetime="2026-11-25T11:57:00Z" title="Checked at 12:57">just now<\/time>/,
  );
  const later = new Date('2026-11-25T12:02:00Z');
  const html = renderPanel({ date: '2026-11-26', hour: 18, data, now: later });
  assert.match(html, />5 min ago<\/time>/);
  assert.doesNotMatch(html, /checked 12:57/i);
  const hours = renderPanel({
    date: '2026-11-26',
    hour: 18,
    data,
    now: new Date('2026-11-25T14:00:00Z'),
  });
  assert.match(hours, />2 h ago<\/time>/);
});

test('free venues show price, MultiSport, website and Google Maps links', () => {
  const html = renderPanel({ date: '2026-11-26', hour: 18, data, now: NOW });
  assert.match(html, /280–380 Kč \/ hour/);
  assert.match(html, /MultiSport accepted/);
  assert.match(html, /50 % off the court price/);
  assert.match(html, /href="https:\/\/www\.example\.com\/kuklenska"[^>]*>Website/);
  assert.match(html, /href="https:\/\/www\.google\.com\/maps\/search\/\?api=1&amp;query=/);
  assert.match(html, /Rating &amp; reviews on Google Maps/);
});

test('a venue without extra details just omits them', () => {
  const plain = makeCalendar('2026-11-25', '2026-11-27', [
    { venue: makeVenue('kuklenska', 'Plain Hall') },
  ]);
  const html = renderPanel({ date: '2026-11-26', hour: 18, data: plain, now: NOW });
  assert.doesNotMatch(html, /MultiSport|Price|>Website/);
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
