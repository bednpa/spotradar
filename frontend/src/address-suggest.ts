/** Pure logic and rendering of the address combobox (live suggestions). */
import { GEOCODE_QUERY_MAX, GEOCODE_QUERY_MIN } from '@spotradar/shared';
import type { GeocodeResponse } from '@spotradar/shared';
import { ApiRequestError } from './api.ts';
import { escapeHtml } from './html.ts';

export const SUGGEST_DEBOUNCE_MS = 300;

export type SuggestState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; items: GeocodeResponse[] }
  | { status: 'empty' }
  | { status: 'error'; message: string };

/** Suggestions are only requested for 2–200 characters of (trimmed) text. */
export function canSuggest(text: string): boolean {
  const length = text.trim().length;
  return length >= GEOCODE_QUERY_MIN && length <= GEOCODE_QUERY_MAX;
}

/** Result of a finished request → state (an empty list is the "no matching places" state). */
export function suggestStateFromResult(items: GeocodeResponse[]): SuggestState {
  return items.length === 0 ? { status: 'empty' } : { status: 'ready', items };
}

/** Non-blocking error state of the suggestions. */
export function suggestErrorState(error: unknown): SuggestState {
  if (error instanceof ApiRequestError && error.code === 'GEOCODER_UNAVAILABLE') {
    return {
      status: 'error',
      message: 'Suggestions unavailable right now. Press Enter to search for the address.',
    };
  }
  return {
    status: 'error',
    message: 'Suggestions unavailable. Press Enter to search for the address.',
  };
}

/** Text of the status line under the field (loading / empty / error). */
export function suggestStatusText(state: SuggestState): string {
  switch (state.status) {
    case 'loading':
      return 'Searching places…';
    case 'empty':
      return 'No matching places';
    case 'error':
      return state.message;
    case 'ready':
      return `${state.items.length} ${state.items.length === 1 ? 'suggestion' : 'suggestions'} available`;
    default:
      return '';
  }
}

/** The listbox is shown only when there are options to choose from. */
export function isListboxOpen(state: SuggestState): boolean {
  return state.status === 'ready' && state.items.length > 0;
}

/**
 * Next active option for ArrowUp/ArrowDown (wraps around); -1 = no active option.
 * Returns the current index for other keys.
 */
export function moveActive(current: number, key: string, count: number): number {
  if (count <= 0) return -1;
  if (key === 'ArrowDown') return current >= count - 1 ? 0 : current + 1;
  if (key === 'ArrowUp') return current <= 0 ? count - 1 : current - 1;
  return current;
}

export const LISTBOX_ID = 'address-listbox';

export function optionId(index: number): string {
  return `address-option-${index}`;
}

export function renderSuggestionOptions(items: readonly GeocodeResponse[], active: number): string {
  return items
    .map(
      (item, i) =>
        `<li id="${optionId(i)}" role="option" class="option${i === active ? ' is-active' : ''}" data-index="${i}" aria-selected="${i === active}"><span class="option-icon" aria-hidden="true"></span><span>${escapeHtml(item.label)}</span></li>`,
    )
    .join('');
}

/** Keeps only the latest request: older responses are ignored ("stale response" race). */
export class LatestOnly {
  private current = 0;

  /** Starts a new request and invalidates all earlier ones. */
  start(): number {
    return ++this.current;
  }

  /** Invalidates every pending request (e.g. the input was cleared). */
  cancel(): void {
    this.current++;
  }

  isCurrent(token: number): boolean {
    return token === this.current;
  }
}

/** Trailing-edge debounce with explicit cancel. */
export class Debouncer {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly delayMs: number;

  constructor(delayMs: number = SUGGEST_DEBOUNCE_MS) {
    this.delayMs = delayMs;
  }

  schedule(fn: () => void): void {
    this.cancel();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      fn();
    }, this.delayMs);
  }

  cancel(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
