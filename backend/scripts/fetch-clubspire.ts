/**
 * Developer tool: downloads a live ClubSpire day timeline, saves the raw HTML
 * and prints the free slots the parser extracts – used to verify the parser
 * against real pages and to refresh fixtures (sanitize before committing).
 * Never used by tests.
 *
 * Usage: npm run fetch:clubspire -w @spotradar/backend -- <baseUrl> <tabIdx> <YYYY-MM-DD> <outFile>
 */
import { writeFile } from 'node:fs/promises';
import { buildClubspireUrl, USER_AGENT } from '../src/connectors/clubspire/connector.ts';
import { parseClubspireTimeline } from '../src/connectors/clubspire/parser.ts';

const [baseUrl, tabIdx, date, outFile] = process.argv.slice(2);
if (!baseUrl || !tabIdx || !date || !outFile) {
  console.error('Usage: fetch-clubspire <baseUrl> <tabIdx> <YYYY-MM-DD> <outFile>');
  process.exit(1);
}

const url = buildClubspireUrl({ type: 'clubspire', baseUrl, tabIdx: Number(tabIdx) }, date);
const res = await fetch(url, {
  headers: { 'user-agent': USER_AGENT },
  signal: AbortSignal.timeout(15_000),
});
const html = await res.text();
await writeFile(outFile, html);
console.log(`${res.status} ${url.href} -> ${outFile} (${html.length} bytes)`);
console.table(parseClubspireTimeline(html));
