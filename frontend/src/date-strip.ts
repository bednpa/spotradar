/** Horizontally scrollable day picker (one pill per searchable day). */
import { dateRange } from '@spotradar/shared';
import type { CalendarView, SearchWindow } from '@spotradar/shared';
import { parseYmd } from './calendar-range.ts';
import { formatLongDate, formatShortWeekday } from './format.ts';
import { escapeHtml } from './html.ts';

export interface DateStripItem {
  date: string;
  /** "Wed" */
  weekday: string;
  /** 25 */
  day: number;
  isToday: boolean;
  selected: boolean;
  /** Accessible name, e.g. "Wednesday 25 November" ("Today, Wednesday …" for today). */
  ariaLabel: string;
}

export function buildDateStrip(window: SearchWindow, selected: string): DateStripItem[] {
  return dateRange(window.from, window.to).map((date) => {
    const isToday = date === window.from;
    const long = formatLongDate(date);
    return {
      date,
      weekday: formatShortWeekday(date),
      day: parseYmd(date).day,
      isToday,
      selected: date === selected,
      ariaLabel: isToday ? `Today, ${long}` : long,
    };
  });
}

/** Month/Year have no single day to select, so a pick switches to the default Day/Week view. */
export function viewAfterDateSelect(view: CalendarView, wide: boolean): CalendarView {
  if (view === 'month' || view === 'year') return wide ? 'week' : 'day';
  return view;
}

/** Target index of an arrow/Home/End key press inside the strip; null for other keys. */
export function stripKeyTarget(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowLeft':
      return Math.max(0, index - 1);
    case 'ArrowRight':
      return Math.min(count - 1, index + 1);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

export function renderDateStrip(window: SearchWindow, selected: string): string {
  const pills = buildDateStrip(window, selected)
    .map(
      (item) =>
        `<button type="button" class="day-pill${item.isToday ? ' is-today' : ''}" data-action="pick-date" data-date="${item.date}" data-key="pill-${item.date}" aria-pressed="${item.selected}"><span class="day-pill-wd" aria-hidden="true">${item.isToday ? 'Today' : item.weekday}</span><span class="day-pill-num" aria-hidden="true">${item.day}</span><span class="visually-hidden">${escapeHtml(item.ariaLabel)}</span></button>`,
    )
    .join('');
  return `<div class="date-strip" role="group" aria-label="Select a day" data-strip>${pills}</div>`;
}
