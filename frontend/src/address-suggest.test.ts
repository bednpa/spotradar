import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiRequestError } from './api.ts';
import {
  Debouncer,
  LatestOnly,
  canSuggest,
  isListboxOpen,
  moveActive,
  renderSuggestionOptions,
  suggestErrorState,
  suggestStateFromResult,
  suggestStatusText,
} from './address-suggest.ts';

test('canSuggest needs 2–200 trimmed characters', () => {
  assert.equal(canSuggest(''), false);
  assert.equal(canSuggest(' a '), false);
  assert.equal(canSuggest('ab'), true);
  assert.equal(canSuggest('  ab  '), true);
  assert.equal(canSuggest('x'.repeat(200)), true);
  assert.equal(canSuggest('x'.repeat(201)), false);
});

test('results map to ready / empty states and the listbox opens only with options', () => {
  const items = [{ lat: 1, lng: 2, label: 'Brno' }];
  const ready = suggestStateFromResult(items);
  assert.deepEqual(ready, { status: 'ready', items });
  assert.equal(isListboxOpen(ready), true);
  const empty = suggestStateFromResult([]);
  assert.deepEqual(empty, { status: 'empty' });
  assert.equal(isListboxOpen(empty), false);
  assert.equal(isListboxOpen({ status: 'loading' }), false);
});

test('status texts for loading, empty and error', () => {
  assert.match(suggestStatusText({ status: 'loading' }), /Searching/);
  assert.equal(suggestStatusText({ status: 'empty' }), 'No matching places');
  assert.equal(suggestStatusText({ status: 'idle' }), '');
  assert.match(
    suggestStatusText({ status: 'ready', items: [{ lat: 1, lng: 2, label: 'a' }] }),
    /1 suggestion/,
  );
  const error = suggestErrorState(new ApiRequestError(502, 'GEOCODER_UNAVAILABLE', 'down'));
  assert.equal(error.status, 'error');
  assert.match(suggestStatusText(error), /^Suggestions unavailable/);
  assert.match(suggestStatusText(suggestErrorState(new Error('x'))), /^Suggestions unavailable/);
});

test('moveActive wraps around with ArrowDown/ArrowUp', () => {
  assert.equal(moveActive(-1, 'ArrowDown', 3), 0);
  assert.equal(moveActive(0, 'ArrowDown', 3), 1);
  assert.equal(moveActive(2, 'ArrowDown', 3), 0);
  assert.equal(moveActive(-1, 'ArrowUp', 3), 2);
  assert.equal(moveActive(0, 'ArrowUp', 3), 2);
  assert.equal(moveActive(2, 'ArrowUp', 3), 1);
  assert.equal(moveActive(1, 'a', 3), 1);
  assert.equal(moveActive(1, 'ArrowDown', 0), -1);
});

test('options are rendered with ARIA roles, escaped labels and the active state', () => {
  const html = renderSuggestionOptions(
    [
      { lat: 1, lng: 2, label: 'Kuklenská <b>, Brno' },
      { lat: 3, lng: 4, label: 'Brno' },
    ],
    1,
  );
  assert.equal((html.match(/role="option"/g) ?? []).length, 2);
  assert.match(html, /id="address-option-0"[^>]*aria-selected="false"/);
  assert.match(html, /id="address-option-1"[^>]*is-active[^>]*aria-selected="true"/);
  assert.match(html, /Kuklenská &lt;b&gt;, Brno/);
});

test('LatestOnly ignores stale responses', () => {
  const latest = new LatestOnly();
  const first = latest.start();
  const second = latest.start();
  assert.equal(latest.isCurrent(first), false);
  assert.equal(latest.isCurrent(second), true);
  latest.cancel();
  assert.equal(latest.isCurrent(second), false);
});

test('Debouncer runs only the last scheduled call and can be cancelled', async () => {
  const debouncer = new Debouncer(15);
  const calls: string[] = [];
  debouncer.schedule(() => calls.push('a'));
  debouncer.schedule(() => calls.push('b'));
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.deepEqual(calls, ['b']);

  debouncer.schedule(() => calls.push('c'));
  debouncer.cancel();
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.deepEqual(calls, ['b']);
});
