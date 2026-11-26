/**
 * Developer tool: builds the ŽLTC Brno parser fixtures from the raw research recordings.
 *
 * Input:  .research/zltc/firestore-courts.json, firestore-config-reservations.json and
 *         reservations-2026-11-{26,27,28}.json (Firestore REST answers recorded 2026-11-26; the
 *         reservation days were fetched with a `select` of `dates` and `reservations` only).
 *         `firestore-reservations-list.json` (hand-redacted, unprojected) is NOT used.
 * Output: backend/src/connectors/zltc/fixtures/{courts,config-reservations,reservations-<day>}.json
 *         - config: the pricing tables are dropped (the connector does not read them),
 *         - reservation documents: the random document ids are replaced by "doc-N" and the
 *           create/update times are dropped. The script fails unless every document holds
 *           exactly the projected fields (`dates`, `reservations` with `court_id` and
 *           `segment_idxs` only), so names or user ids can never slip into a fixture.
 *
 * Usage (cwd = backend/; `node --test` runs the top-level code of this file):
 *   npm run test:only -w @spotradar/backend -- scripts/sanitize-zltc-fixtures.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const inDir = new URL('../../.research/zltc/', import.meta.url);
const outDir = new URL('../src/connectors/zltc/fixtures/', import.meta.url);
mkdirSync(outDir, { recursive: true });

type Json = Record<string, unknown>;

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(new URL(name, inDir), 'utf8'));
}

function asObject(value: unknown, what: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${what} is not an object`);
  }
  return value as Json;
}

function onlyKeys(value: Json, allowed: string[], what: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${what} has an unexpected field "${key}"`);
  }
}

function write(name: string, value: unknown, indent?: number): void {
  writeFileSync(new URL(name, outDir), `${JSON.stringify(value, null, indent)}\n`);
}

// Courts: names and season flags only.
const courts = asObject(readJson('firestore-courts.json'), 'courts');
for (const doc of courts.documents as unknown[]) {
  onlyKeys(
    asObject(asObject(doc, 'court').fields, 'court fields'),
    ['name', 'is_winter', 'is_summer'],
    'court',
  );
}
write('courts.json', courts, 2);

// Config: everything but the pricing tables.
const config = asObject(readJson('firestore-config-reservations.json'), 'config');
const configFields = asObject(config.fields, 'config fields');
delete configFields.pricing_winter;
delete configFields.pricing_summer;
write('config-reservations.json', config, 2);

// Booked segments of three days.
for (const day of ['2026-11-26', '2026-11-27', '2026-11-28']) {
  const rows = readJson(`reservations-${day}.json`);
  if (!Array.isArray(rows)) throw new Error(`reservations-${day}.json is not an array`);
  let n = 0;
  const cleaned = rows.map((row: unknown) => {
    const { document, readTime, ...rest } = asObject(row, 'row');
    onlyKeys(rest, [], 'row');
    if (document === undefined) return { readTime };
    const doc = asObject(document, 'document');
    const fields = asObject(doc.fields, 'document fields');
    onlyKeys(fields, ['dates', 'reservations'], 'document');
    const entries = asObject(asObject(fields.reservations, 'reservations').arrayValue, 'array');
    for (const entry of (entries.values ?? []) as unknown[]) {
      const entryFields = asObject(
        asObject(asObject(entry, 'entry').mapValue, 'map').fields,
        'entry',
      );
      onlyKeys(entryFields, ['court_id', 'segment_idxs'], 'reservation entry');
    }
    n += 1;
    return {
      document: {
        name: `projects/zltc-prod-c9e6c/databases/(default)/documents/reservations/doc-${n}`,
        fields,
      },
      readTime,
    };
  });
  write(`reservations-${day}.json`, cleaned);
}
