import { readFileSync } from 'node:fs';
import { HttpError } from './errors.ts';
import type { FetchFn } from './connectors/types.ts';
import type { Geocoder } from './services/geocode.ts';

/**
 * Stub mode (`SPOTRADAR_STUB_EXTERNAL=1`, used by the Playwright E2E tests):
 * no network access. The real ClubSpire connector and parser still run; only
 * the injected `fetch` is fake.
 */
export function isStubMode(env: NodeJS.ProcessEnv): boolean {
  return env.SPOTRADAR_STUB_EXTERNAL === '1';
}

const KUKLENSKA_HOST = 'kuklenska.clubspire.cz';
const KUKLENSKA_FIXTURE = new URL(
  './connectors/clubspire/fixtures/kuklenska-2026-11-25.html',
  import.meta.url,
);

let kuklenskaHtml: string | undefined;

/** Kuklenská returns the sanitized fixture (for any date); every other host fails. */
export function createStubFetch(): FetchFn {
  return (input) => {
    const url = new URL(input);
    if (url.host !== KUKLENSKA_HOST) {
      return Promise.reject(new Error(`Stub mode: ${url.host} is unreachable`));
    }
    kuklenskaHtml ??= readFileSync(KUKLENSKA_FIXTURE, 'utf8');
    return Promise.resolve(
      new Response(kuklenskaHtml, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    );
  };
}

export function createStubGeocoder(): Geocoder {
  return {
    geocode(q) {
      const lower = q.toLowerCase();
      if (lower.includes('nowhere')) {
        return Promise.reject(new HttpError('LOCATION_NOT_FOUND', `No location found for "${q}"`));
      }
      if (lower.includes('praha')) {
        return Promise.resolve({ lat: 50.0755, lng: 14.4378, label: 'Praha, Česko' });
      }
      return Promise.resolve({ lat: 49.1951, lng: 16.6068, label: 'Brno, Česko' });
    },
  };
}
