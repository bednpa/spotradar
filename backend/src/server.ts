import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';
import {
  createAvailabilityService,
  createDefaultConnectors,
} from './connectors/availabilityService.ts';
import { createCacheWarmer } from './connectors/cacheWarmer.ts';
import { VENUE_RECORDS } from './data/venues.ts';
import { createVenueRepository } from './repositories/venueRepository.ts';
import { createGeocoder } from './services/geocode.ts';
import { createSuggester } from './services/suggest.ts';
import { createStubFetch, createStubGeocoder, createStubSuggester, isStubMode } from './stubs.ts';

const port = Number(process.env.PORT) || 3000;
const host = '0.0.0.0';
const now = (): Date => new Date();
const stub = isStubMode(process.env);
if (stub) console.log('SPOTRADAR_STUB_EXTERNAL=1: external services are stubbed');

const venues = createVenueRepository(VENUE_RECORDS);
const availability = createAvailabilityService({
  connectors: createDefaultConnectors(stub ? { fetch: createStubFetch() } : {}),
  now,
});
const warmer = createCacheWarmer({ venues, availability, now });

const server = createApp({
  venues,
  availability,
  geocoder: stub ? createStubGeocoder() : createGeocoder({ now }),
  suggest: stub ? createStubSuggester() : createSuggester({ now }),
  now,
  staticDir: fileURLToPath(new URL('../../frontend/dist/', import.meta.url)),
});

server.listen(port, host, () => {
  console.log(`SpotRadar backend listening on http://${host}:${port}`);
  warmer.start();
});

// Render sends SIGTERM on deploy/restart: stop accepting connections and exit cleanly.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    warmer.stop();
    server.close(() => process.exit(0));
    server.closeAllConnections();
  });
}
