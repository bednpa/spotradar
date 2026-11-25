/**
 * Developer tool: measures how long `/api/calendar` takes against the LIVE booking systems
 * (same code path as the endpoint, in-process, no HTTP server). Prints the time of a cold
 * day, a cold week, the same week again (warm cache) and the following week; then the effect
 * of the background cache warmer (one warming pass, then the week request) and of
 * stale-while-revalidate (expired but not too old entries are answered at once). Never used
 * by tests; numbers depend on the network and on the upstream servers.
 *
 * Usage: npm run measure:calendar -w @spotradar/backend [-- <YYYY-MM-DD start, default today>]
 */
import { addDays, toLocalDateTime } from '@spotradar/shared';
import {
  createAvailabilityService,
  createDefaultConnectors,
} from '../src/connectors/availabilityService.ts';
import type { AvailabilityService } from '../src/connectors/availabilityService.ts';
import { createCacheWarmer } from '../src/connectors/cacheWarmer.ts';
import { VENUE_RECORDS } from '../src/data/venues.ts';
import { createVenueRepository } from '../src/repositories/venueRepository.ts';
import { getCalendar } from '../src/services/calendar.ts';

const now = (): Date => new Date();
const start = process.argv[2] ?? toLocalDateTime(now()).date;
const silent = { info: (): void => undefined, warn: (): void => undefined };
const venues = createVenueRepository(VENUE_RECORDS);

function newService(options: { cacheTtlMs?: number } = {}): AvailabilityService {
  return createAvailabilityService({
    connectors: createDefaultConnectors(),
    now,
    logger: silent,
    ...options,
  });
}

async function measure(
  availability: AvailabilityService,
  label: string,
  from: string,
  to: string,
): Promise<void> {
  const began = performance.now();
  const response = await getCalendar(
    { sport: 'badminton', from, to },
    { venues, availability, now },
  );
  const ms = Math.round(performance.now() - began);
  const cells = response.days.flatMap((day) => day.venues);
  const live = cells.filter((cell) => cell.availability.status === 'live').length;
  console.log(
    `${label.padEnd(24)} ${from}..${to} ${String(ms).padStart(6)} ms  (${live}/${cells.length} venue-days live)`,
  );
}

const weekEnd = addDays(start, 6);

console.log('--- plain service (no warming) ---');
const plain = newService();
await measure(plain, 'day (cold)', addDays(start, 1), addDays(start, 1));
await measure(plain, 'week (cold)', start, weekEnd);
await measure(plain, 'week (warm)', start, weekEnd);
await measure(plain, 'next week (cold)', addDays(start, 7), addDays(start, 13));

console.log('--- with cache warmer ---');
const warmedService = newService();
const warmer = createCacheWarmer({ venues, availability: warmedService, now, logger: silent });
const warmBegan = performance.now();
const report = await warmer.runOnce();
console.log(
  `warmer pass              ${String(Math.round(performance.now() - warmBegan)).padStart(6)} ms  ` +
    `(${report.read} read, ${report.skipped} skipped, ${report.failed} failed; skipped hosts: ${report.skippedHosts.join(', ') || 'none'})`,
);
await measure(warmedService, 'week (after warming)', start, weekEnd);

console.log('--- stale-while-revalidate ---');
// Tiny TTL: entries are expired a moment after they are stored, but far younger than staleMaxAge.
const swr = newService({ cacheTtlMs: 50 });
await measure(swr, 'week (cold, fills cache)', start, weekEnd);
await new Promise((resolve) => setTimeout(resolve, 100));
await measure(swr, 'week (stale, instant)', start, weekEnd);
// Background refreshes are still running; let them finish so the process exits cleanly.
await new Promise((resolve) => setTimeout(resolve, 100));
