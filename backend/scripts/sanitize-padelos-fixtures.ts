/**
 * Reproducible sanitizer of the recorded PadelOS answers (`.research/padelos/*.json`, curl
 * commands in its NOTES.md) into the committed parser fixtures.
 *
 * Keeps `data[0].id`, `name`, `addresses[0].timezone`, `clubPolicies` and `availability`
 * (courts reduced to `id` + `name`); drops `company` (T&C, FAQ, business contacts),
 * `openMatchPolicies`, `theme`, `imageUrl` and everything else. It also prints a summary of the
 * minutes that occur in the slots (to pick the grid of the parser).
 *
 * Usage (from the repository root; node runs the file's top-level code):
 *   npm run test:only -w @spotradar/backend -- scripts/sanitize-padelos-fixtures.ts
 * Paths are relative to `backend/` (the cwd of the workspace script).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const INPUT_DIR = '../.research/padelos';
const OUTPUT_DIR = 'src/connectors/padelos/fixtures';
const FILES: [input: string, output: string][] = [
  ['slatina-2026-11-26.json', 'slatina-2026-11-26.json'],
  ['slatina-2026-11-27.json', 'slatina-2026-11-27.json'],
  ['slatina-2026-11-28.json', 'slatina-2026-11-28.json'],
  ['kravihora-2026-11-26.json', 'kravihora-2026-11-26.json'],
];

interface RawCourt {
  id: string;
  name: string;
}
interface RawSlot {
  date: string;
  startTime: string;
  endTime: string;
  courts: RawCourt[];
}
interface RawGroup {
  duration: string;
  slotCount?: number;
  slots: RawSlot[];
}
interface RawClub {
  id: string;
  name: string;
  addresses: { timezone: string }[];
  clubPolicies: unknown;
  availability: RawGroup[];
}

function sanitize(raw: { success: boolean; data: RawClub[] }): unknown {
  const club = raw.data[0];
  if (!club) throw new Error('no data[0]');
  return {
    success: raw.success,
    data: [
      {
        id: club.id,
        name: club.name,
        addresses: [{ timezone: club.addresses[0]?.timezone }],
        clubPolicies: club.clubPolicies,
        availability: club.availability.map((group) => ({
          duration: group.duration,
          slotCount: group.slotCount,
          slots: group.slots.map((s) => ({
            date: s.date,
            startTime: s.startTime,
            endTime: s.endTime,
            courts: s.courts.map((c) => ({ id: c.id, name: c.name })),
          })),
        })),
      },
    ],
  };
}

mkdirSync(OUTPUT_DIR, { recursive: true });
for (const [input, output] of FILES) {
  const raw = JSON.parse(readFileSync(`${INPUT_DIR}/${input}`, 'utf8')) as {
    success: boolean;
    data: RawClub[];
  };
  const clean = sanitize(raw);
  const text = `${JSON.stringify(clean, null, 1)}\n`;
  writeFileSync(`${OUTPUT_DIR}/${output}`, text);

  const minutes = new Set<string>();
  const dates = new Set<string>();
  for (const group of raw.data[0]?.availability ?? []) {
    for (const s of group.slots) {
      minutes.add(s.startTime.slice(3));
      minutes.add(s.endTime.slice(3));
      dates.add(s.date);
    }
  }
  console.log(
    `${output}: ${text.length} bytes, id=${raw.data[0]?.id}, groups=${(
      raw.data[0]?.availability ?? []
    )
      .map((g) => `${g.duration}:${g.slots.length}`)
      .join(',')}, minutes={${[...minutes].sort().join(',')}}, dates={${[...dates].join(',')}}`,
  );
}
