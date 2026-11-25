/** Pure render-to-string functions for the calendar page. All dynamic text is escaped. */
import { CALENDAR_VIEWS, DISTANCE_OPTIONS_KM, SPORTS, getSearchWindow } from '@spotradar/shared';
import type { CalendarResponse, CalendarView, SportId } from '@spotradar/shared';
import { LISTBOX_ID } from './address-suggest.ts';
import {
  anchorFor,
  isInRange,
  monthGrid,
  monthLast,
  parseYmd,
  periodTitle,
  visibleHours,
  weekDates,
  yearMonths,
} from './calendar-range.ts';
import {
  cellAriaLabel,
  computeCell,
  indexDays,
  isCellSelectable,
  slotHourRange,
  summarizeDay,
  venueCoverage,
} from './cells.ts';
import type { CellOptions, DayIndex, HourCell } from './cells.ts';
import {
  formatDistance,
  formatLongDate,
  formatVenues,
  hourLabel,
  monthName,
  sportNameLower,
  windowDescription,
} from './format.ts';
import { escapeHtml, safeHref } from './html.ts';
import type { AppState } from './query.ts';
import { ROUTE_PATHS } from './router.ts';
import type { Route } from './router.ts';
import { isDistanceFilterEnabled, locationStatusText } from './state.ts';
import type { CalendarState, LocationState } from './state.ts';

export { escapeHtml, safeHref };

const VIEW_LABELS: Record<CalendarView, string> = {
  day: 'Day',
  week: 'Week',
  month: 'Month',
  year: 'Year',
};

const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

// ---------- header and filters ----------

const NAV_ITEMS: { route: Route; label: string }[] = [
  { route: 'calendar', label: 'Reserve' },
  { route: 'venues', label: 'Venues' },
];

/** Primary navigation: Reserve (calendar) and Venues (directory). */
export function renderMainNav(active: Route): string {
  return NAV_ITEMS.map(
    ({ route, label }) =>
      `<a class="nav-pill" href="${ROUTE_PATHS[route]}" data-route="${route}"${route === active ? ' aria-current="page"' : ''}>${label}</a>`,
  ).join('');
}

export function renderSportChips(selected: SportId): string {
  return SPORTS.map(
    (sport) =>
      `<button type="button" class="chip" data-sport="${sport.id}" aria-pressed="${sport.id === selected}">${escapeHtml(sport.name)}</button>`,
  ).join('');
}

export function renderDistanceChips(selectedKm: number | null, enabled: boolean): string {
  const disabled = enabled ? '' : ' disabled';
  const any = `<button type="button" class="chip" data-km="" aria-pressed="${selectedKm === null}"${disabled}>Any</button>`;
  const options = DISTANCE_OPTIONS_KM.map(
    (km) =>
      `<button type="button" class="chip" data-km="${km}" aria-pressed="${km === selectedKm}"${disabled}>${km} km</button>`,
  ).join('');
  return any + options;
}

const ARROW_ICON =
  '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M3.5 11.2 20.2 3.8c.7-.3 1.4.4 1.1 1.1L13.9 21.6c-.3.7-1.3.6-1.5-.1l-1.6-6.7a1 1 0 0 0-.7-.7l-6.7-1.6c-.7-.2-.8-1.2-.1-1.5z" fill="currentColor"/></svg>';

export function renderFilters(state: AppState, location: LocationState): string {
  const status = locationStatusText(location);
  const busy = location.status === 'locating' || location.status === 'resolving';
  const hasOrigin = location.status === 'set';
  return `
<div class="filter-group">
  <span id="sport-label" class="label">Sport</span>
  <div id="sport-chips" class="chips" role="group" aria-labelledby="sport-label">${renderSportChips(state.sport)}</div>
</div>
<div class="filter-group filter-location">
  <label for="address">Address</label>
  <div class="combo">
    <div class="field">
      <input id="address" type="text" role="combobox" aria-expanded="false" aria-controls="${LISTBOX_ID}" aria-autocomplete="list" autocomplete="off" placeholder="Search an address in Brno" />
      <button type="button" id="clear-location" class="field-btn" aria-label="Clear location"${hasOrigin ? '' : ' hidden'}><span aria-hidden="true">×</span></button>
      <button type="button" id="use-location" class="field-btn field-btn-accent" aria-label="Use my location"${busy ? ' disabled' : ''}>${ARROW_ICON}</button>
    </div>
    <ul id="${LISTBOX_ID}" class="listbox" role="listbox" aria-label="Address suggestions" hidden></ul>
  </div>
  <p id="suggest-status" class="hint" role="status"></p>
  <p id="location-status" class="hint${location.status === 'error' ? ' is-error' : ''}" role="status">${escapeHtml(status)}</p>
</div>
<div class="filter-group">
  <span id="distance-label" class="label">Max distance</span>
  <div id="distance-chips" class="chips" role="group" aria-labelledby="distance-label">${renderDistanceChips(state.maxDistanceKm, isDistanceFilterEnabled(location))}</div>
</div>`;
}

// ---------- toolbar ----------

const UNIT_LABEL: Record<CalendarView, string> = {
  day: 'day',
  week: 'week',
  month: 'month',
  year: 'year',
};

export function renderToolbar(state: AppState): string {
  const unit = UNIT_LABEL[state.view];
  const views = CALENDAR_VIEWS.map(
    (view) =>
      `<button type="button" class="seg" data-view="${view}" data-key="view-${view}" aria-pressed="${view === state.view}">${VIEW_LABELS[view]}</button>`,
  ).join('');
  return `
<div class="toolbar-nav">
  <button type="button" class="btn btn-ghost" data-action="today" data-key="today">Today</button>
  <button type="button" class="icon-btn" data-action="prev" data-key="prev" aria-label="Previous ${unit}"><span aria-hidden="true">‹</span></button>
  <button type="button" class="icon-btn" data-action="next" data-key="next" aria-label="Next ${unit}"><span aria-hidden="true">›</span></button>
  <h2 id="period-title" class="period-title" aria-live="polite">${escapeHtml(periodTitle(state.view, state.date))}</h2>
</div>
<div class="segmented" role="group" aria-label="Calendar view">${views}</div>`;
}

// ---------- states ----------

export function renderSkeleton(): string {
  const rows = Array.from({ length: 8 }, () => '<div class="skeleton skeleton-row"></div>').join(
    '',
  );
  return `<div class="skeleton-grid" aria-busy="true"><p class="visually-hidden">Loading availability…</p>${rows}</div>`;
}

export function renderError(message: string): string {
  return `<div class="state state-error" role="alert"><p>${escapeHtml(message)}</p><button type="button" class="btn btn-primary" data-action="retry">Try again</button></div>`;
}

export function renderEmptyVenues(maxDistanceKm: number | null, sport: SportId): string {
  const name = escapeHtml(sportNameLower(sport));
  if (maxDistanceKm !== null) {
    return `<div class="state state-empty"><h3>No ${name} venues within ${maxDistanceKm} km</h3><p>Try a larger distance or remove the limit.</p><button type="button" class="btn btn-primary" data-action="clear-distance">Clear distance</button></div>`;
  }
  return `<div class="state state-empty"><h3>No ${name} venues found</h3><p>There are no venues for this sport yet.</p></div>`;
}

export function renderOutside(): string {
  return `<div class="state state-empty"><h3>Not available yet</h3><p>Availability is shown for ${windowDescription()}.</p><button type="button" class="btn btn-primary" data-action="today">Go to today</button></div>`;
}

export function renderWindowHint(): string {
  return `<p class="muted window-hint">Availability is only known for ${windowDescription()}.</p>`;
}

// ---------- cells ----------

function cellContent(cell: HourCell, size: 'week' | 'day'): string {
  const { summary } = cell;
  if (size === 'week') {
    return cell.kind === 'free'
      ? `<span class="cell-n" aria-hidden="true">${summary.freeVenues}</span>`
      : '';
  }
  // The visible text is decorative: the button's aria-label carries the full description.
  switch (cell.kind) {
    case 'free':
      return `<span class="cell-main" aria-hidden="true">${formatVenues(summary.freeVenues)} · ${summary.freeCourts} ${summary.freeCourts === 1 ? 'court' : 'courts'} free</span>`;
    case 'none':
      return '<span class="cell-main" aria-hidden="true">Nothing free</span>';
    case 'past':
      return '<span class="cell-main" aria-hidden="true">Past</span>';
    case 'outside':
      return '<span class="cell-main" aria-hidden="true">Not available yet</span>';
  }
}

/**
 * Accessible name of a button whose visible text is shortened: the visible text is
 * aria-hidden and this visually hidden text is the name (so name and content never disagree).
 */
function hiddenLabel(text: string): string {
  return `<span class="visually-hidden">${escapeHtml(text)}</span>`;
}

function renderCell(cell: HourCell, size: 'week' | 'day', col: number, row: number): string {
  const key = `cell-${cell.date}-${cell.hour}`;
  const disabled = isCellSelectable(cell) ? '' : ' disabled';
  return `<div role="gridcell" class="gc"><button type="button" class="cell cell-${cell.kind} cell-${size}" data-level="${cell.level}" data-action="open-slot" data-date="${cell.date}" data-hour="${cell.hour}" data-key="${key}" data-col="${col}" data-row="${row}"${disabled}>${cellContent(cell, size)}${hiddenLabel(cellAriaLabel(cell))}</button></div>`;
}

export interface GridContext {
  state: AppState;
  data: CalendarResponse;
  days: DayIndex;
  now: Date;
}

function cellOptions(ctx: GridContext): CellOptions {
  return { now: ctx.now };
}

/** Empty state of Day/Week when no venue has any slot in the shown period. */
export function renderNoSlots(view: 'day' | 'week'): string {
  return `<div class="state state-empty" data-testid="no-slots"><h3>No slots this ${view}</h3><p>No venue is open or free in this period. Try another ${view}.</p></div>`;
}

/** Hour rows for the dates shown (shared by all days of a week); null = nothing to show. */
function gridHours(ctx: GridContext, dates: readonly string[]): number[] | null {
  const range = slotHourRange(ctx.days, ctx.data.venues, dates);
  return range ? visibleHours(range.fromHour, range.toHour) : null;
}

export function renderWeek(ctx: GridContext): string {
  const dates = weekDates(ctx.state.date);
  const hours = gridHours(ctx, dates);
  if (!hours) return renderNoSlots('week');
  const today = getSearchWindow(ctx.now).from;
  const header = dates
    .map((date, i) => {
      const day = parseYmd(date).day;
      const current = date === today ? ' aria-current="date"' : '';
      return `<div role="columnheader" class="ch${date === today ? ' is-today' : ''}"${current}><span class="ch-day">${WEEKDAY_SHORT[i]}</span><span class="ch-num">${day}</span></div>`;
    })
    .join('');
  const rows = hours
    .map((hour, r) => {
      const cells = dates
        .map((date, c) =>
          renderCell(
            computeCell(ctx.days, ctx.data.venues, date, hour, cellOptions(ctx)),
            'week',
            c,
            r,
          ),
        )
        .join('');
      return `<div role="row" class="gr gr-week"><div role="rowheader" class="rh">${hourLabel(hour)}</div>${cells}</div>`;
    })
    .join('');
  return `<div class="grid-scroll"><div role="grid" class="grid grid-week" aria-label="Week calendar, hours by day" data-grid><div role="row" class="gr gr-week gr-head"><div role="columnheader" class="ch ch-corner"><span class="visually-hidden">Hour</span></div>${header}</div>${rows}</div></div>`;
}

export function renderDay(ctx: GridContext): string {
  const { date } = ctx.state;
  const hours = gridHours(ctx, [date]);
  if (!hours) return renderNoSlots('day');
  const rows = hours
    .map(
      (hour, r) =>
        `<div role="row" class="gr gr-day"><div role="rowheader" class="rh">${hourLabel(hour)}</div>${renderCell(computeCell(ctx.days, ctx.data.venues, date, hour, cellOptions(ctx)), 'day', 0, r)}</div>`,
    )
    .join('');
  return `<div class="grid-scroll"><div role="grid" class="grid grid-day" aria-label="${escapeHtml(formatLongDate(date))}, hours" data-grid>${rows}</div></div>`;
}

export function renderMonth(ctx: GridContext): string {
  const window = getSearchWindow(ctx.now);
  const { month } = parseYmd(ctx.state.date);
  const head = WEEKDAY_SHORT.map(
    (d) => `<div role="columnheader" class="ch"><span class="ch-day">${d}</span></div>`,
  ).join('');
  const options = cellOptions(ctx);
  const weeks = monthGrid(ctx.state.date)
    .map((week) => {
      const cells = week
        .map((date) => {
          const inWindow = isInRange(date, window);
          const other = parseYmd(date).month !== month ? ' is-other' : '';
          const today = date === window.from ? ' is-today' : '';
          const num = parseYmd(date).day;
          if (!inWindow) {
            const reason = date < window.from ? 'in the past' : 'not available yet';
            return `<div role="gridcell" class="gc"><button type="button" class="mday is-disabled${other}" disabled><span class="mday-num" aria-hidden="true">${num}</span>${hiddenLabel(`${formatLongDate(date)}: ${reason}`)}</button></div>`;
          }
          const s = summarizeDay(ctx.days, ctx.data.venues, date, options);
          let label = `${formatLongDate(date)}: nothing free`;
          let body = '<span class="mday-line muted" aria-hidden="true">Nothing free</span>';
          if (s.freeHours > 0) {
            label = `${formatLongDate(date)}: ${s.freeHours} free ${s.freeHours === 1 ? 'hour' : 'hours'}, best at ${hourLabel(s.bestHour ?? 0)}`;
            body = `<span class="mday-line mday-free" aria-hidden="true">${s.freeHours} free ${s.freeHours === 1 ? 'hour' : 'hours'}</span><span class="mday-line muted" aria-hidden="true">best ${hourLabel(s.bestHour ?? 0)}</span>`;
          }
          return `<div role="gridcell" class="gc"><button type="button" class="mday${other}${today}" data-action="open-day" data-date="${date}" data-key="day-${date}"><span class="mday-num" aria-hidden="true">${num}</span>${body}${hiddenLabel(label)}</button></div>`;
        })
        .join('');
      return `<div role="row" class="gr gr-month">${cells}</div>`;
    })
    .join('');
  return `<div class="grid-scroll"><div role="grid" class="grid grid-month" aria-label="${escapeHtml(periodTitle('month', ctx.state.date))}"><div role="row" class="gr gr-month gr-head">${head}</div>${weeks}</div></div>`;
}

export function renderYear(state: AppState, now: Date): string {
  const window = getSearchWindow(now);
  const minis = yearMonths(state.date)
    .map((first) => {
      const { year, month } = parseYmd(first);
      const cells = monthGrid(first)
        .flat()
        .map((date) => {
          const p = parseYmd(date);
          if (p.month !== month) return '<i class="d d-blank"></i>';
          const cls = isInRange(date, window) ? ' d-window' : '';
          return `<i class="d${cls}">${p.day}</i>`;
        })
        .join('');
      const anchor = anchorFor(first, 'month', window.from);
      const hasWindow = monthGridHasWindow(first, window);
      return `<button type="button" class="mini${hasWindow ? ' has-window' : ''}" data-action="open-month" data-date="${anchor}" data-key="month-${first}" aria-label="${monthName(month)} ${year}${hasWindow ? ', has availability' : ''}"><span class="mini-title">${monthName(month)}</span><span class="mini-grid" aria-hidden="true">${cells}</span></button>`;
    })
    .join('');
  return `<div class="year-grid" role="group" aria-label="${escapeHtml(periodTitle('year', state.date))}">${minis}</div>`;
}

function monthGridHasWindow(first: string, window: { from: string; to: string }): boolean {
  return first <= window.to && monthLast(first) >= window.from;
}

/** Calendar body for the current state (loading / error / empty / outside / view). */
export function renderCalendar(state: AppState, calendar: CalendarState, now: Date): string {
  switch (calendar.status) {
    case 'loading':
      return renderSkeleton();
    case 'error':
      return renderError(calendar.message);
    case 'outside':
      return renderOutside();
    case 'success': {
      if (calendar.data.venues.length === 0)
        return renderEmptyVenues(state.maxDistanceKm, state.sport);
      const ctx: GridContext = { state, data: calendar.data, days: indexDays(calendar.data), now };
      switch (state.view) {
        case 'day':
          return renderDay(ctx);
        case 'week':
          return renderWeek(ctx);
        case 'month':
          return renderMonth(ctx) + renderWindowHint();
        case 'year':
          return renderYear(state, now) + renderWindowHint();
      }
    }
  }
}

// ---------- legend ----------

const COVERAGE_BADGE = {
  live: ['badge-live', 'Live data'],
  unavailable: ['badge-neutral', 'Live data temporarily unreadable'],
  unknown: ['badge-neutral', 'No live data yet'],
} as const;

export function renderLegend(data: CalendarResponse): string {
  if (data.venues.length === 0) return '';
  const items = venueCoverage(data)
    .map(({ venue, coverage }) => {
      const [cls, text] = COVERAGE_BADGE[coverage];
      const distance =
        venue.distanceKm !== undefined ? ` · ${escapeHtml(formatDistance(venue.distanceKm))}` : '';
      return `<li data-venue-id="${escapeHtml(venue.venue.id)}" data-coverage="${coverage}"><span class="venue-name">${escapeHtml(venue.venue.name)}</span><span class="muted">${escapeHtml(venue.venue.district)}${distance}</span><span class="badge ${cls}">${text}</span></li>`;
    })
    .join('');
  return `
<h2 id="legend-title">Venues and data quality</h2>
<p class="muted">The calendar shows free courts at venues with live data, read from their own booking pages. For the others there is no live data yet – open a slot to see them and check their websites.</p>
<ul class="key" aria-label="Calendar colours">
  <li><span class="swatch swatch-free"></span>Free court (number = venues)</li>
  <li><span class="swatch swatch-none"></span>Nothing free</li>
</ul>
<ul class="venue-list">${items}</ul>`;
}
