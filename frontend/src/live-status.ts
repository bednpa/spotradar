/**
 * The one component that shows how fresh a venue's availability is. It is used by the
 * venue list and the slot panel so both read the same: "● Live · 5 min ago",
 * "● Unavailable", "● Check on website". It is always a single line (see `.live-status`).
 */
import { formatTimeAgo } from '@spotradar/shared';
import type { AvailabilityStatus } from '@spotradar/shared';
import { formatClockTime } from './format.ts';
import { escapeHtml } from './html.ts';

export interface LiveStatusInput {
  status: AvailabilityStatus;
  /** ISO timestamp of the last read (live only). */
  checkedAt?: string;
  /** Injectable clock for "x min ago". */
  now?: Date;
}

export interface LiveStatusParts {
  /** Short visible text without the dot, e.g. "Live · 5 min ago". */
  text: string;
  /** Full text for the tooltip (absolute time when known). */
  title: string;
}

export function liveStatusParts({
  status,
  checkedAt,
  now = new Date(),
}: LiveStatusInput): LiveStatusParts {
  switch (status) {
    case 'live': {
      if (checkedAt === undefined) return { text: 'Live', title: 'Live availability' };
      const ago = formatTimeAgo(checkedAt, now);
      if (ago === '') return { text: 'Live', title: 'Live availability' };
      const clock = formatClockTime(checkedAt);
      return {
        text: `Live · ${ago}`,
        title: clock ? `Live availability, checked at ${clock}` : `Live availability, ${ago}`,
      };
    }
    case 'unavailable':
      return {
        text: 'Unavailable',
        title: "Couldn't read availability right now – check on the venue's website",
      };
    case 'unknown':
      return {
        text: 'Check on website',
        title: 'No live data for this venue – check on its website',
      };
  }
}

export function renderLiveStatus(input: LiveStatusInput): string {
  const { text, title } = liveStatusParts(input);
  return `<span class="live-status live-status-${input.status}" data-testid="live-status" data-status="${input.status}" title="${escapeHtml(title)}"><span class="live-status-dot" aria-hidden="true">●</span> <span class="live-status-text">${escapeHtml(text)}</span></span>`;
}
