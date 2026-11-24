import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';
import { SEED_VENUES } from './data/seedVenues.ts';
import { createInMemoryReservationRepository } from './repositories/reservationRepository.ts';
import { createVenueRepository } from './repositories/venueRepository.ts';

const port = Number(process.env.PORT) || 3000;
const host = '0.0.0.0';

const server = createApp({
  venues: createVenueRepository(SEED_VENUES),
  reservations: createInMemoryReservationRepository(),
  now: () => new Date(),
  staticDir: fileURLToPath(new URL('../../frontend/dist/', import.meta.url)),
});

server.listen(port, host, () => {
  console.log(`SpotRadar backend listening on http://${host}:${port}`);
});

// Render sends SIGTERM on deploy/restart: stop accepting connections and exit cleanly.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    server.close(() => process.exit(0));
    server.closeAllConnections();
  });
}
