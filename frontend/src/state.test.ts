import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiRequestError } from './api.ts';
import {
  buildReservationTarget,
  geolocationErrorMessage,
  isDistanceFilterEnabled,
  locationStatusText,
  locationToFormValues,
  openReservation,
  reservationFailed,
  reservationInvalid,
  reservationSubmitting,
  reservationSucceeded,
  searchErrorState,
  searchInvalidState,
  validateReservationForm,
} from './state.ts';
import type { LocationState } from './state.ts';
import { QUERY, RESERVATION, makeResult } from './test-fixtures.test.ts';

const SET: LocationState = { status: 'set', lat: 49.1951234, lng: 16.6068 };

test('distance filter is enabled only when a location is set', () => {
  assert.equal(isDistanceFilterEnabled({ status: 'idle' }), false);
  assert.equal(isDistanceFilterEnabled({ status: 'locating' }), false);
  assert.equal(isDistanceFilterEnabled({ status: 'error', message: 'x' }), false);
  assert.equal(isDistanceFilterEnabled(SET), true);
});

test('location status texts and form values', () => {
  assert.equal(locationStatusText({ status: 'locating' }), 'Locating…');
  assert.match(locationStatusText(SET), /Location set/);
  assert.equal(locationStatusText({ status: 'error', message: 'denied' }), 'denied');
  assert.deepEqual(locationToFormValues(SET), { lat: '49.19512', lng: '16.60680' });
  assert.deepEqual(locationToFormValues({ status: 'idle' }), { lat: '', lng: '' });
});

test('geolocation errors map to friendly messages', () => {
  assert.match(geolocationErrorMessage(1), /denied/);
  assert.match(geolocationErrorMessage(2), /unavailable/);
  assert.match(geolocationErrorMessage(3), /too long/);
  assert.match(geolocationErrorMessage(undefined), /unavailable/);
});

test('search error states use the API message and issues', () => {
  const state = searchErrorState(
    new ApiRequestError(400, 'VALIDATION_ERROR', 'Invalid query', [
      { field: 'time', message: 'time must be HH:00 or HH:30' },
    ]),
  );
  assert.deepEqual(state, {
    status: 'error',
    message: 'Invalid query',
    issues: [{ field: 'time', message: 'time must be HH:00 or HH:30' }],
  });
  const unknown = searchErrorState(new Error('boom'));
  assert.equal(unknown.status, 'error');
  assert.match(unknown.status === 'error' ? unknown.message : '', /Something went wrong/);
  assert.equal(searchInvalidState([]).status, 'error');
});

const target = buildReservationTarget(QUERY, makeResult(), makeResult().availableCourts[0]!);

test('buildReservationTarget combines query, venue, court and price', () => {
  assert.deepEqual(target, {
    venueId: 'v1',
    venueName: 'Tennis Club Brno',
    courtId: 'c1',
    courtName: 'Court 1',
    sport: 'tennis',
    date: '2026-11-25',
    time: '18:00',
    durationMinutes: 90,
    totalPriceCzk: 525,
  });
});

test('reservation validation reports field errors for empty name and bad e-mail', () => {
  const result = validateReservationForm(target, { customerName: ' ', customerEmail: 'nope' });
  assert.ok(!result.ok);
  assert.ok(result.fieldErrors.customerName);
  assert.ok(result.fieldErrors.customerEmail);
});

test('reservation validation builds a trimmed request', () => {
  const result = validateReservationForm(target, {
    customerName: '  Jana  ',
    customerEmail: ' jana@example.com ',
  });
  assert.ok(result.ok);
  assert.equal(result.request.customerName, 'Jana');
  assert.equal(result.request.customerEmail, 'jana@example.com');
  assert.equal(result.request.courtId, 'c1');
});

test('reservation flow: open -> invalid -> submitting -> success', () => {
  const opened = openReservation(target);
  assert.equal(opened.status, 'editing');

  const values = { customerName: '', customerEmail: '' };
  const invalid = reservationInvalid(opened, values, { customerName: 'required' });
  assert.ok(invalid.status === 'editing' && invalid.fieldErrors.customerName === 'required');

  const submitting = reservationSubmitting(invalid, {
    customerName: 'Jana',
    customerEmail: 'jana@example.com',
  });
  assert.equal(submitting.status, 'submitting');

  const done = reservationSucceeded(submitting, RESERVATION);
  assert.ok(done.status === 'success' && done.reservation.id === 'r-123');
});

test('409 SLOT_UNAVAILABLE returns to editing with a refresh offer', () => {
  const submitting = reservationSubmitting(openReservation(target), {
    customerName: 'Jana',
    customerEmail: 'jana@example.com',
  });
  const failed = reservationFailed(
    submitting,
    new ApiRequestError(409, 'SLOT_UNAVAILABLE', 'Court is already booked'),
  );
  assert.ok(failed.status === 'editing');
  assert.ok(failed.failure);
  assert.equal(failed.failure.canRefresh, true);
  assert.match(failed.failure.message, /Court is already booked/);
  assert.match(failed.failure.message, /Refresh the results/);
  assert.equal(failed.values.customerName, 'Jana');
});

test('other failures keep the form values and map validation issues to fields', () => {
  const submitting = reservationSubmitting(openReservation(target), {
    customerName: 'J',
    customerEmail: 'jana@example.com',
  });
  const failed = reservationFailed(
    submitting,
    new ApiRequestError(400, 'VALIDATION_ERROR', 'Invalid request', [
      { field: 'customerName', message: 'too short' },
    ]),
  );
  assert.ok(failed.status === 'editing');
  assert.equal(failed.fieldErrors.customerName, 'too short');
  assert.equal(failed.failure?.canRefresh, false);

  const network = reservationFailed(
    submitting,
    new ApiRequestError(0, 'NETWORK_ERROR', 'Cannot reach the server.'),
  );
  assert.ok(network.status === 'editing' && network.failure?.message === 'Cannot reach the server.');
});

test('transitions from the wrong state are ignored', () => {
  const closed = { status: 'closed' } as const;
  assert.equal(reservationSubmitting(closed, { customerName: '', customerEmail: '' }), closed);
  assert.equal(reservationFailed(closed, new Error('x')), closed);
  assert.equal(reservationSucceeded(closed, RESERVATION), closed);
});
