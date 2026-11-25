import { addDays, isInSeason, toLocalDateTime } from '@spotradar/shared';
import type { Season } from '@spotradar/shared';
import type { Logger } from '../logger.ts';
import type { VenueRepository } from '../repositories/venueRepository.ts';
import type { AvailabilityTarget } from './types.ts';

/** One sport of one venue to keep warm. */
interface WarmTarget extends AvailabilityTarget {
  season: Season | undefined;
}
import { AVAILABILITY_CACHE_TTL_MS, sourceHost } from './availabilityService.ts';
import type { AvailabilityService } from './availabilityService.ts';

export const WARM_INTERVAL_MS = 10 * 60 * 1000;
export const WARM_DAYS = 7;

export interface WarmReport {
  durationMs: number;
  /** Successful connector reads. */
  read: number;
  /** Reads not attempted (fresh enough, host backed off, rest of a failed host). */
  skipped: number;
  failed: number;
  /** Hosts that were skipped (backed off or failed with a connection error) in this pass. */
  skippedHosts: string[];
}

export interface CacheWarmerOptions {
  venues: VenueRepository;
  availability: AvailabilityService;
  now: () => Date;
  intervalMs?: number;
  /** Number of days starting today (Europe/Prague). */
  days?: number;
  /** Entries younger than this are not re-read (default: expires before the next pass). */
  refreshIfOlderThanMs?: number;
  logger?: Logger;
}

export interface CacheWarmer {
  /** Runs a pass now, then every `intervalMs`. Timers are unref'd. */
  start(): void;
  stop(): void;
  /** Runs one pass; joins a running pass instead of overlapping. Never rejects. */
  runOnce(): Promise<WarmReport>;
}

/**
 * Keeps the availability cache warm in the background so user requests are answered from it.
 * Hosts are processed in parallel, each host's venue x date reads one after another (polite,
 * and MemberZone serves the other 6 days from the week page it already fetched).
 */
export function createCacheWarmer(options: CacheWarmerOptions): CacheWarmer {
  const intervalMs = options.intervalMs ?? WARM_INTERVAL_MS;
  const days = options.days ?? WARM_DAYS;
  const refreshIfOlderThanMs =
    options.refreshIfOlderThanMs ?? Math.max(0, AVAILABILITY_CACHE_TTL_MS - intervalMs);
  const logger: Logger = options.logger ?? console;
  const { availability } = options;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<WarmReport> | undefined;

  async function warmHost(
    host: string,
    targets: WarmTarget[],
    dates: string[],
    report: WarmReport,
  ): Promise<void> {
    if (availability.isHostBackedOff(host)) {
      report.skipped += targets.length * dates.length;
      report.skippedHosts.push(host);
      return;
    }
    let remaining = targets.length * dates.length;
    for (const target of targets) {
      for (const [index, date] of dates.entries()) {
        remaining--;
        const result = isInSeason(target.season, date)
          ? await availability.warm(target, date, { refreshIfOlderThanMs })
          : 'skipped'; // out of season: never read (see getDayAvailability)
        if (result === 'ok') report.read++;
        else if (result === 'skipped') report.skipped++;
        else report.failed++;
        if (result === 'failed' && availability.isHostBackedOff(host)) {
          report.skipped += remaining;
          report.skippedHosts.push(host);
          return;
        }
        if (result === 'failed') {
          // Any other failure (changed markup, HTTP 5xx): don't retry this venue's other dates in
          // this pass – a broken page would otherwise cost a full read per date every 10 minutes.
          const rest = dates.length - index - 1;
          report.skipped += rest;
          remaining -= rest;
          break;
        }
      }
    }
  }

  async function pass(): Promise<WarmReport> {
    const began = performance.now();
    const report: WarmReport = { durationMs: 0, read: 0, skipped: 0, failed: 0, skippedHosts: [] };
    try {
      const today = toLocalDateTime(options.now()).date;
      const dates = Array.from({ length: days }, (_, i) => addDays(today, i));
      const byHost = new Map<string, WarmTarget[]>();
      for (const venue of options.venues.getAll()) {
        for (const offering of venue.offerings) {
          const host = sourceHost(offering.source);
          if (host === undefined || !availability.supports(offering)) continue;
          const target: WarmTarget = {
            venueId: venue.id,
            sport: offering.sport,
            source: offering.source,
            season: offering.openingHours?.season,
          };
          byHost.set(host, [...(byHost.get(host) ?? []), target]);
        }
      }
      await Promise.all(
        [...byHost].map(([host, targets]) => warmHost(host, targets, dates, report)),
      );
    } catch (err) {
      logger.warn(`[warmer] pass failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    report.durationMs = Math.round(performance.now() - began);
    const hosts = report.skippedHosts.length > 0 ? report.skippedHosts.join(', ') : 'none';
    logger.info(
      `[warmer] pass in ${report.durationMs} ms: ${report.read} read, ${report.skipped} skipped, ${report.failed} failed (skipped hosts: ${hosts})`,
    );
    return report;
  }

  function runOnce(): Promise<WarmReport> {
    if (running) return running;
    const current = pass().finally(() => {
      running = undefined;
    });
    running = current;
    return current;
  }

  return {
    runOnce,
    start() {
      if (timer) return;
      void runOnce();
      timer = setInterval(() => {
        void runOnce();
      }, intervalMs);
      timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
}
