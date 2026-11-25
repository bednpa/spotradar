import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveStatusParts, renderLiveStatus } from './live-status.ts';

const CHECKED = '2026-11-25T11:57:00Z';

test('live status shows "Live · x min ago" and the clock time in the title', () => {
  const now = new Date('2026-11-25T12:02:00Z');
  assert.deepEqual(liveStatusParts({ status: 'live', checkedAt: CHECKED, now }), {
    text: 'Live · 5 min ago',
    title: 'Live availability, checked at 12:57',
  });
  const html = renderLiveStatus({ status: 'live', checkedAt: CHECKED, now });
  assert.match(html, /class="live-status live-status-live"/);
  assert.match(html, /data-testid="live-status" data-status="live"/);
  assert.match(html, /title="Live availability, checked at 12:57"/);
  assert.match(html, /<span class="live-status-dot" aria-hidden="true">●<\/span>/);
  assert.match(html, />Live · 5 min ago<\/span>/);
});

test('live without a timestamp is just "Live"', () => {
  assert.equal(liveStatusParts({ status: 'live' }).text, 'Live');
  assert.equal(liveStatusParts({ status: 'live', checkedAt: 'garbage' }).text, 'Live');
});

test('non-live states use the same component with their own text', () => {
  const unavailable = renderLiveStatus({ status: 'unavailable' });
  assert.match(unavailable, /live-status live-status-unavailable/);
  assert.match(unavailable, />Unavailable</);
  const unknown = renderLiveStatus({ status: 'unknown' });
  assert.match(unknown, /live-status live-status-unknown/);
  assert.match(unknown, />Check on website</);
  assert.match(unknown, /data-testid="live-status"/);
});

test('the status is a single inline element without line breaks', () => {
  const html = renderLiveStatus({ status: 'live', checkedAt: CHECKED });
  assert.doesNotMatch(html, /<br|<p|<div|\n/);
});
