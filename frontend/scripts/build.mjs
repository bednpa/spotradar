/**
 * Dependency-free frontend build.
 *
 * - Strips TypeScript types (node:module stripTypeScriptTypes, Node >= 22.13) from
 *   frontend/src → dist/app and shared/src → dist/shared, skipping *.test.ts files.
 * - Rewrites relative "./x.ts" import specifiers to "./x.js".
 * - Copies frontend/public (index.html with the import map for @spotradar/shared, CSS) to dist.
 *
 * Usage: node scripts/build.mjs [--watch]
 */
import { stripTypeScriptTypes } from 'node:module';
import { watch } from 'node:fs';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appSrcDir = path.join(frontendDir, 'src');
const sharedSrcDir = path.resolve(frontendDir, '../shared/src');
const publicDir = path.join(frontendDir, 'public');
const distDir = path.join(frontendDir, 'dist');

/** Rewrites relative `.ts` import/export specifiers to `.js`. */
export function rewriteImportSpecifiers(code) {
  return code.replace(
    /(\bfrom\s*|\bimport\s*\(?\s*)(['"])(\.{1,2}\/[^'"]+?)\.ts\2/g,
    '$1$2$3.js$2',
  );
}

/** True for TypeScript sources that belong in the browser bundle. */
export function isBuildableSource(relativePath) {
  return (
    relativePath.endsWith('.ts') &&
    !relativePath.endsWith('.test.ts') &&
    !relativePath.endsWith('.d.ts')
  );
}

/** Strips types and rewrites imports of a single TypeScript source. */
export function transformSource(code) {
  return rewriteImportSpecifiers(stripTypeScriptTypes(code, { mode: 'strip' }));
}

async function transpileDir(srcDir, outDir) {
  const entries = await readdir(srcDir, { recursive: true });
  for (const rel of entries) {
    if (!isBuildableSource(rel)) continue;
    const source = await readFile(path.join(srcDir, rel), 'utf8');
    const outFile = path.join(outDir, rel.replace(/\.ts$/, '.js'));
    await mkdir(path.dirname(outFile), { recursive: true });
    await writeFile(outFile, transformSource(source));
  }
}

export async function build() {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });
  await cp(publicDir, distDir, { recursive: true });
  await transpileDir(appSrcDir, path.join(distDir, 'app'));
  await transpileDir(sharedSrcDir, path.join(distDir, 'shared'));
}

async function runBuild() {
  try {
    await build();
    console.log(`[frontend] built to ${path.relative(process.cwd(), distDir) || distDir}`);
  } catch (error) {
    console.error('[frontend] build failed:', error);
    return false;
  }
  return true;
}

function startWatch() {
  let timer;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void runBuild(), 100);
  };
  for (const dir of [appSrcDir, sharedSrcDir, publicDir]) {
    watch(dir, { recursive: true }, schedule);
  }
  console.log('[frontend] watching for changes…');
}

const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const ok = await runBuild();
  if (process.argv.includes('--watch')) startWatch();
  else if (!ok) process.exitCode = 1;
}
