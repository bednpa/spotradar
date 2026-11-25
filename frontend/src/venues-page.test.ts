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
import { hours, makeVenue } from './test-fixtures.test.ts';

const detailed: VenueListItem = {
  liveAvailability: true,
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
      accepted: true,
      coverage: { kind: 'percentOff', percent: 50 },
      note: 'max 4 players',
    },
    otherActivities: ['Squash', 'Table <tennis>'],
    phone: '+420 123 456 789',
    openingHours: { ...hours('08:00', '22:00'), approximate: true },
  }),
};

const bare: VenueListItem = {
  liveAvailability: false,
  venue: makeVenue('bare', 'Bare Hall', { courts: undefined }),
};

test('card shows name, district, address, sports, other activities, courts and price', () => {
  const html = renderVenueCard(detailed);
  assert.match(html, /<h3>Badminton Líšeň<\/h3>/);
  assert.match(html, /Brno-Líšeň · Badminton Líšeň street 1, Brno/);
  assert.match(html, /tag tag-sport">Badminton</);
  assert.match(html, /class="tag">Squash</);
  assert.match(html, /Table &lt;tennis&gt;/);
  assert.match(html, /<dt>Courts<\/dt><dd>4 courts<\/dd>/);
  assert.match(html, /<summary>from 280 Kč \/ h<\/summary>/);
});

test('card price expands to the full table and note', () => {
  const html = renderVenueCard(detailed);
  assert.match(html, /<details class="price-details"/);
  assert.match(html, /<li>Mon–Fri 07:00–15:00: 280 Kč \/ h<\/li>/);
  assert.match(html, /<li>Sat, Sun 08:00–22:00: 400 Kč \/ h<\/li>/);
  assert.match(html, /Students -20 %/);
});

test('card shows opening hours compactly and marks approximate hours', () => {
  const html = renderVenueCard(detailed);
  assert.match(html, /Mon–Sun<\/span> 08:00–22:00/);
  assert.match(html, /badge-neutral">approximate</);
  const exact = renderVenueCard(bare);
  assert.doesNotMatch(exact, /approximate/);
});

test('card shows the MultiSport label with note, and unknown when absent', () => {
  assert.match(renderVenueCard(detailed), />MultiSport · 50 % off</);
  assert.match(renderVenueCard(detailed), /title="max 4 players"/);
  assert.match(
    renderVenueCard(bare),
    /<dt>MultiSport<\/dt><dd><span class="badge[^>]*>MultiSport: unknown</,
  );
  const not = renderVenueCard({
    ...bare,
    venue: { ...bare.venue, multisport: { accepted: false } },
  });
  assert.match(not, />No MultiSport</);
});

test('card links: website, booking, Google Maps rating link and phone; live badge', () => {
  const html = renderVenueCard(detailed);
  assert.match(
    html,
    /href="https:\/\/www\.example\.com\/lisen"[^>]*rel="noopener noreferrer">Website/,
  );
  assert.match(html, /href="https:\/\/example\.com\/lisen"[^>]*>Book on venue's website/);
  assert.match(html, /google\.com\/maps\/search[^"]*"[^>]*>Rating &amp; reviews on Google Maps/);
  assert.match(html, /href="tel:\+420123456789">\+420 123 456 789</);
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
    venue: makeVenue('x', 'X', {
      website: 'javascript:alert(1)',
      bookingUrl: 'javascript:alert(2)',
      phone: 'call me',
    }),
  });
  assert.doesNotMatch(html, /javascript:|tel:/);
});

test('body renders the loading skeleton, error with retry and the empty state', () => {
  const filter = { q: 'zzz <x>', sport: null };
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
    { q: '', sport: null },
  );
  assert.doesNotMatch(unfiltered, /clear-venue-filters/);
});

test('body lists cards with a result count', () => {
  const html = renderVenuesBody(
    { status: 'success', data: { query: {}, venues: [detailed, bare] } },
    { q: '', sport: null },
  );
  assert.match(html, /role="status">2 venues</);
  assert.equal((html.match(/class="vcard"/g) ?? []).length, 2);
  assert.equal(venueCountText(1), '1 venue');
  assert.equal(venueCountText(0), 'No venues');
});

test('controls: labelled search box and sport chips', () => {
  const html = renderVenuesControls({ q: 'li"sen', sport: 'badminton' });
  assert.match(html, /<label for="venue-search">Search venues<\/label>/);
  assert.match(html, /type="search"[^>]*value="li&quot;sen"/);
  assert.match(html, /data-venue-sport="" aria-pressed="false">All sports</);
  assert.match(html, /data-venue-sport="badminton" aria-pressed="true">Badminton</);
});

test('URL state and API query', () => {
  assert.deepEqual(venuesFilterFromSearch('?q=%20lisen%20&sport=badminton'), {
    q: 'lisen',
    sport: 'badminton',
  });
  assert.deepEqual(venuesFilterFromSearch('?sport=tennis'), { q: '', sport: null });
  assert.equal(venuesFilterFromSearch(`?q=${'x'.repeat(300)}`).q.length, 100);
  assert.equal(venuesFilterToSearch({ q: 'a b', sport: 'badminton' }), 'q=a+b&sport=badminton');
  assert.equal(venuesFilterToSearch({ q: ' ', sport: null }), '');
  assert.deepEqual(toVenueQuery({ q: ' lisen ', sport: null }), { q: 'lisen' });
  assert.deepEqual(toVenueQuery({ q: '', sport: 'badminton' }), { sport: 'badminton' });
  assert.deepEqual(toVenueQuery({ q: '', sport: null }), {});
});

test('error messages', () => {
  assert.match(venuesErrorMessage(new ApiRequestError(400, 'VALIDATION_ERROR', 'x')), /not valid/);
  assert.equal(venuesErrorMessage(new ApiRequestError(500, 'INTERNAL_ERROR', 'Boom')), 'Boom');
  assert.match(venuesErrorMessage(new Error('x')), /Something went wrong/);
});
