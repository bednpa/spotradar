/** Venue detail helpers shared by the venues page and the slot panel. */
import { WEEKDAYS, googleMapsUrl } from '@spotradar/shared';
import type { MultisportInfo, OpeningHours, Venue, Weekday } from '@spotradar/shared';
import { escapeHtml, externalLink } from './html.ts';

export const GOOGLE_MAPS_LINK_TEXT = 'Rating & reviews on Google Maps';

const WEEKDAY_LABEL: Record<Weekday, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
};

export interface HoursGroup {
  /** "Mon–Fri", "Sat" … */
  days: string;
  /** "07:00–22:00" or "Closed" */
  text: string;
}

function dayText(hours: OpeningHours, day: Weekday): string {
  const entry = hours.days[day];
  return entry ? `${entry.open}–${entry.close}` : 'Closed';
}

/** Compact opening hours: consecutive days with identical hours are merged ("Mon–Fri 07:00–22:00"). */
export function groupOpeningHours(hours: OpeningHours): HoursGroup[] {
  const groups: HoursGroup[] = [];
  let start = 0;
  while (start < WEEKDAYS.length) {
    const first = WEEKDAYS[start] as Weekday;
    const text = dayText(hours, first);
    let end = start;
    while (end + 1 < WEEKDAYS.length && dayText(hours, WEEKDAYS[end + 1] as Weekday) === text) {
      end++;
    }
    const last = WEEKDAYS[end] as Weekday;
    const days =
      start === end
        ? WEEKDAY_LABEL[first]
        : `${WEEKDAY_LABEL[first]}${end === start + 1 ? ', ' : '–'}${WEEKDAY_LABEL[last]}`;
    groups.push({ days, text });
    start = end + 1;
  }
  return groups;
}

/** Plain text of the MultiSport acceptance ("accepted – 1 card = 60 min" / "not accepted" / "unknown"). */
export function multisportText(multisport: MultisportInfo | undefined): string {
  if (!multisport) return 'unknown';
  if (!multisport.accepted) return 'not accepted';
  return multisport.terms ? `accepted – ${multisport.terms}` : 'accepted';
}

/** Short badge for the slot panel (omitted when acceptance is unknown). */
export function renderMultisportBadge(multisport: MultisportInfo | undefined): string {
  if (!multisport) return '';
  const cls = multisport.accepted ? 'badge-multisport' : 'badge-neutral';
  const label = multisport.accepted ? 'MultiSport accepted' : 'MultiSport not accepted';
  const terms = multisport.accepted && multisport.terms ? multisport.terms : '';
  return `<span class="badge ${cls}"${terms ? ` title="${escapeHtml(terms)}"` : ''}>${label}</span>${terms ? `<span class="muted fact-terms">${escapeHtml(terms)}</span>` : ''}`;
}

export function googleMapsLink(venue: Pick<Venue, 'name' | 'address'>): string {
  return externalLink(googleMapsUrl(venue), GOOGLE_MAPS_LINK_TEXT);
}
