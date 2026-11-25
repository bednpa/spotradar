/** Minimal client-side routing: two pages, History API. Pure helpers only. */

export const ROUTES = ['calendar', 'venues'] as const;
export type Route = (typeof ROUTES)[number];

export const ROUTE_PATHS: Record<Route, string> = { calendar: '/', venues: '/venues' };

export const ROUTE_TITLES: Record<Route, string> = {
  calendar: 'SpotRadar – free badminton courts in Brno',
  venues: 'Venues – SpotRadar',
};

/** "/venues" and "/venues/" → venues; everything else is the calendar. */
export function routeFromPath(pathname: string): Route {
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed === ROUTE_PATHS.venues ? 'venues' : 'calendar';
}

/** Path + query string for pushState ("?" is added only when `search` is not empty). */
export function routeUrl(route: Route, search = ''): string {
  const query = search.replace(/^\?/, '');
  return query === '' ? ROUTE_PATHS[route] : `${ROUTE_PATHS[route]}?${query}`;
}

export interface ClickLike {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
}

/** True for a plain left click (modified clicks keep the browser's "open in new tab"). */
export function isPlainLeftClick(event: ClickLike): boolean {
  return (
    event.button === 0 &&
    !event.defaultPrevented &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

/** Value of `data-route` when it is a known route. */
export function isRoute(value: unknown): value is Route {
  return typeof value === 'string' && (ROUTES as readonly string[]).includes(value);
}
