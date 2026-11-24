import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeHtml,
  renderReservationDialog,
  renderResults,
  renderSearchForm,
} from './render.ts';
import { getDefaultFormValues } from './query.ts';
import {
  buildReservationTarget,
  openReservation,
  reservationFailed,
  reservationSubmitting,
  reservationSucceeded,
} from './state.ts';
import { ApiRequestError } from './api.ts';
import { QUERY, RESERVATION, makeResponse, makeResult } from './test-fixtures.test.ts';

const FORM_VALUES = getDefaultFormValues(new Date('2026-11-24T10:10:00Z'));

test('escapeHtml escapes all special characters', () => {
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
});

test('search form has labelled controls and bounds from the booking window', () => {
  const html = renderSearchForm({
    values: FORM_VALUES,
    location: { status: 'idle' },
    minDate: '2026-11-24',
    maxDate: '2026-12-07',
  });
  assert.match(html, /<form[^>]*aria-label="Search courts"/);
  for (const [id, label] of [
    ['sport', 'Sport'],
    ['date', 'Date'],
    ['time', 'Start time'],
    ['duration', 'Duration'],
    ['max-distance', 'Max distance'],
  ] as const) {
    assert.match(html, new RegExp(`<label for="${id}">${label}</label>`));
  }
  assert.match(html, /min="2026-11-24" max="2026-12-07" value="2026-11-24"/);
  assert.match(html, /<option value="11:30" selected>11:30<\/option>/);
  assert.match(html, /<option value="60" selected>60 min<\/option>/);
  assert.match(html, /Use my location/);
  assert.match(html, />Search<\/button>/);
  assert.match(html, /<option value=""(?: selected)?>Any distance<\/option>/);
  assert.match(html, /<option value="20">Within 20 km<\/option>/);
});

test('max distance select is disabled until a location is set', () => {
  const base = { values: FORM_VALUES, minDate: '2026-11-24', maxDate: '2026-12-07' };
  const without = renderSearchForm({ ...base, location: { status: 'idle' } });
  const withLocation = renderSearchForm({
    ...base,
    location: { status: 'set', lat: 49.2, lng: 16.6 },
  });
  assert.match(without, /<select id="max-distance"[^>]* disabled>/);
  assert.doesNotMatch(withLocation, /<select id="max-distance"[^>]* disabled>/);
  assert.match(withLocation, /Location set/);
});

test('loading state is an accessible status', () => {
  const html = renderResults({ status: 'loading' });
  assert.match(html, /role="status"/);
  assert.match(html, /Searching for free courts…/);
});

test('error state is an alert listing field issues', () => {
  const html = renderResults({
    status: 'error',
    message: 'Invalid query <b>',
    issues: [{ field: 'date', message: 'date is required' }],
  });
  assert.match(html, /role="alert"/);
  assert.match(html, /Invalid query &lt;b&gt;/);
  assert.match(html, /<strong>date<\/strong>: date is required/);
});

test('empty state hints at changing the search', () => {
  const html = renderResults({ status: 'success', response: makeResponse([]) });
  assert.match(html, /No free courts found/);
  assert.match(html, /different time, another date or a larger max distance/);
  assert.doesNotMatch(html, /<article/);
});

test('results render venue cards with price, distance, hours and reserve buttons', () => {
  const html = renderResults({ status: 'success', response: makeResponse() });
  assert.match(html, /<ul class="venue-list">/);
  assert.match(html, /<article class="venue-card" aria-labelledby="venue-heading-0">/);
  assert.match(html, /<h3 id="venue-heading-0">Tennis Club Brno<\/h3>/);
  assert.match(html, /Hlavní 1, Brno/);
  assert.match(html, /1\.2 km away/);
  assert.match(html, /350 CZK \/ hour · 525 CZK total/);
  assert.match(html, /Open 08:00–22:00/);
  assert.match(html, /aria-label="Reserve Court 1 at Tennis Club Brno"/);
  assert.match(html, /aria-label="Reserve Court 2 at Tennis Club Brno"/);
  assert.match(html, /data-venue-id="v1" data-court-id="c1"/);
  assert.match(html, /Indoor · clay/);
  assert.match(html, /1 venue with free courts/);
});

test('distance is omitted when no location was used', () => {
  const html = renderResults({
    status: 'success',
    response: makeResponse([makeResult({ distanceKm: null })]),
  });
  assert.doesNotMatch(html, /venue-distance/);
});

test('API strings are escaped in results', () => {
  const base = makeResult();
  const html = renderResults({
    status: 'success',
    response: makeResponse([
      makeResult({
        venue: { ...base.venue, name: '<script>alert(1)</script>', address: 'A & B "street"' },
      }),
    ]),
  });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /A &amp; B &quot;street&quot;/);
});

const target = buildReservationTarget(QUERY, makeResult(), makeResult().availableCourts[0]!);

test('closed reservation renders nothing', () => {
  assert.equal(renderReservationDialog({ status: 'closed' }), '');
});

test('reservation form shows summary, labelled fields, confirm and cancel', () => {
  const html = renderReservationDialog(openReservation(target));
  assert.match(html, /<form id="reservation-form" aria-label="Reservation"/);
  assert.match(html, /<label for="res-name">Name<\/label>/);
  assert.match(html, /<label for="res-email">E-mail<\/label>/);
  assert.match(html, /Tennis Club Brno/);
  assert.match(html, /Court 1/);
  assert.match(html, /Wed 25 Nov 2026/);
  assert.match(html, /18:00–19:30 \(90 min\)/);
  assert.match(html, /525 CZK/);
  assert.match(html, />Confirm<\/button>/);
  assert.match(html, /data-action="cancel"/);
});

test('field errors are linked to inputs', () => {
  const state = openReservation(target);
  assert.ok(state.status === 'editing');
  const html = renderReservationDialog({
    ...state,
    values: { customerName: '"><x', customerEmail: '' },
    fieldErrors: { customerEmail: 'customerEmail must be a valid e-mail address' },
  });
  assert.match(html, /id="res-email"[^>]*aria-invalid="true" aria-describedby="res-email-error"/);
  assert.match(html, /<p class="field-error" id="res-email-error">/);
  assert.match(html, /value="&quot;&gt;&lt;x"/);
});

test('submitting state disables the form and shows a status', () => {
  const submitting = reservationSubmitting(openReservation(target), {
    customerName: 'Jana',
    customerEmail: 'jana@example.com',
  });
  const html = renderReservationDialog(submitting);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /role="status"/);
  assert.match(html, /Reserving your court…/);
  assert.match(html, /type="submit" class="button-primary" disabled/);
});

test('409 conflict shows an alert with a refresh action', () => {
  const submitting = reservationSubmitting(openReservation(target), {
    customerName: 'Jana',
    customerEmail: 'jana@example.com',
  });
  const html = renderReservationDialog(
    reservationFailed(
      submitting,
      new ApiRequestError(409, 'SLOT_UNAVAILABLE', 'Court is already booked'),
    ),
  );
  assert.match(html, /role="alert"/);
  assert.match(html, /Court is already booked/);
  assert.match(html, /data-action="refresh"/);
  assert.match(html, /value="Jana"/);
});

test('success shows a confirmation with id, venue, court, time and price', () => {
  const submitting = reservationSubmitting(openReservation(target), {
    customerName: 'Jana',
    customerEmail: 'jana@example.com',
  });
  const html = renderReservationDialog(reservationSucceeded(submitting, RESERVATION));
  assert.match(html, /role="status"/);
  assert.match(html, /Reservation confirmed/);
  assert.match(html, /r-123/);
  assert.match(html, /Tennis Club Brno/);
  assert.match(html, /Court 1/);
  assert.match(html, /18:00–19:30/);
  assert.match(html, /525 CZK/);
  assert.match(html, /data-action="close"/);
});
