/**
 * Developer tool: builds the Komárov parser fixtures from the raw research recordings.
 *
 * Input:  .research/komarov/rozvrh-0.html and rozvrh-1.html (`curl -s -A 'SpotRadar/1.0'
 *         https://www.tenis-komarov.cz/rozvrh/0/` and `.../1/`, recorded 2026-11-26).
 * Output: backend/src/connectors/komarov/fixtures/rozvrh-{0,1}-2026-11-26.html, trimmed to the
 *         `<section id="rezervacni-system">` (timetable, legend, court list). The grid only holds
 *         colour classes, no personal data; the page header and footer (contact data) are dropped.
 *
 * Usage (cwd = backend/; `node --test` runs the top-level code of this file):
 *   npm run test:only -w @spotradar/backend -- scripts/sanitize-komarov-fixtures.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const SECTION_START = '<section class="resume-section" id="rezervacni-system">';
const SECTION_END = '</section>';

const outDir = new URL('../src/connectors/komarov/fixtures/', import.meta.url);
mkdirSync(outDir, { recursive: true });

for (const week of [0, 1]) {
  const html = readFileSync(
    new URL(`../../.research/komarov/rozvrh-${week}.html`, import.meta.url),
    'utf8',
  );
  const start = html.indexOf(SECTION_START);
  const end = html.indexOf(SECTION_END, start);
  if (start < 0 || end < 0) throw new Error(`rozvrh-${week}.html has no reservation section`);
  const section = html.slice(start, end + SECTION_END.length);
  if (/@|\+420|\b\d{3} \d{3} \d{3}\b/.test(section)) {
    throw new Error(`rozvrh-${week}.html section looks like it contains contact data`);
  }
  writeFileSync(new URL(`rozvrh-${week}-2026-11-26.html`, outDir), `${section}\n`);
}
