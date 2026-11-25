import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPanel } from './panel.ts';
import { makeCalendar, makeVenue } from './test-fixtures.test.ts';

const data = makeCalendar('2026-11-25', '2026-11-27');

function order(html: string): string[] {
  return [...html.matchAll(/data-state="(\w+)" data-venue-id="(\w+)"/g)].map(
    (m) => `${m[2]}:${m[1]}`,
  );
}

test('lists every venue: free, check, full, closed – with a booking link for free and check', () => {
  const html = renderPanel({ date: '2026-11-26', hour: 18, data });
  assert.deepEqual(order(html), [
    'kuklenska:free',
    'viktoria:check',
    'unknown:check',
    'full:full',
    'closed:closed',
  ]);
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-labelledby="detail-title"/);
  assert.match(html, /<h2 id="detail-title">18:00–19:00<\/h2>/);
  assert.match(html, /Thursday 26 November/);
  assert.match(html, /1 court free/);
  assert.match(html, /Fully booked/);
  assert.match(html, /Closed/);
  assert.match(html, /Live · checked 12:57/);
  assert.match(html, /Couldn&#39;t|Couldn't read availability right now/);
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

test('empty state when nothing is free still lists check venues', () => {
  const html = renderPanel({ date: '2026-11-26', hour: 12, data });
  assert.match(html, /No badminton venue is free at 12:00–13:00/);
  assert.match(html, /check their websites/);
  assert.deepEqual(order(html), [
    'viktoria:check',
    'unknown:check',
    'kuklenska:full',
    'full:full',
    'closed:closed',
  ]);
  assert.equal((html.match(/Book on venue's website/g) ?? []).length, 2);
});

test('empty state when every venue is closed', () => {
  const html = renderPanel({ date: '2026-11-26', hour: 5, data });
  assert.match(html, /No badminton venue is free at 05:00–06:00/);
  assert.match(html, /Try another hour or day/);
  assert.doesNotMatch(html, /Book on venue's website/);
});

test('distance is shown when known and unsafe links are dropped', () => {
  const html = renderPanel({ date: '2026-11-26', hour: 18, data });
  assert.match(html, /1\.5 km away/);

  const bad = makeCalendar('2026-11-25', '2026-11-27', [
    { venue: makeVenue('kuklenska', 'Evil <Hall>', { bookingUrl: 'javascript:alert(1)' }) },
  ]);
  const unsafe = renderPanel({ date: '2026-11-26', hour: 18, data: bad });
  assert.doesNotMatch(unsafe, /javascript:/);
  assert.match(unsafe, /Evil &lt;Hall&gt;/);
});
