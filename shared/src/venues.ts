/**
 * Pure venue-directory helpers shared by backend (GET /api/venues filtering)
 * and frontend (display).
 */
import type { Venue } from './types.ts';

/** Lower-case and strip diacritics so "lisen" matches "Líšeň". */
export function foldText(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * True when every whitespace-separated word of `q` occurs in the venue's name,
 * district or address (case- and diacritics-insensitive). A blank `q` matches all.
 */
export function matchesVenueQuery(venue: Venue, q: string): boolean {
  const haystack = foldText(`${venue.name} ${venue.district} ${venue.address}`);
  return foldText(q)
    .split(/\s+/)
    .filter((word) => word !== '')
    .every((word) => haystack.includes(word));
}

/** Sort order of GET /api/venues: by name, Czech collation. */
export function compareVenuesByName(a: Venue, b: Venue): number {
  return a.name.localeCompare(b.name, 'cs');
}

/** Google Maps search link for the venue (shows its place card, rating and reviews). */
export function googleMapsUrl(venue: Pick<Venue, 'name' | 'address'>): string {
  const query = encodeURIComponent(`${venue.name}, ${venue.address}`);
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

/**
 * "just now" / "5 min ago" / "2 h ago" / "3 days ago" for an ISO timestamp,
 * relative to `now`. Timestamps in the future (clock skew) read "just now".
 */
export function formatTimeAgo(iso: string, now: Date): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const minutes = Math.floor((now.getTime() - then) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}
