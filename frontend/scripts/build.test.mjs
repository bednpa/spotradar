import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBuildableSource, rewriteImportSpecifiers, transformSource } from './build.mjs';

test('rewriteImportSpecifiers rewrites relative .ts specifiers only', () => {
  const input = [
    "import { a } from './a.ts';",
    'export * from "../b/c.ts";',
    "import './side-effect.ts';",
    "const m = await import('./lazy.ts');",
    "import { SPORTS } from '@spotradar/shared';",
    "const s = 'not-an-import.ts';",
  ].join('\n');
  const output = rewriteImportSpecifiers(input);
  assert.match(output, /from '\.\/a\.js'/);
  assert.match(output, /from "\.\.\/b\/c\.js"/);
  assert.match(output, /import '\.\/side-effect\.js'/);
  assert.match(output, /import\('\.\/lazy\.js'\)/);
  assert.match(output, /from '@spotradar\/shared'/);
  assert.match(output, /'not-an-import\.ts'/);
});

test('isBuildableSource skips tests and declaration files', () => {
  assert.equal(isBuildableSource('main.ts'), true);
  assert.equal(isBuildableSource('nested/render.ts'), true);
  assert.equal(isBuildableSource('render.test.ts'), false);
  assert.equal(isBuildableSource('env.d.ts'), false);
  assert.equal(isBuildableSource('styles.css'), false);
});

test('transformSource strips types and type-only imports', () => {
  const output = transformSource(
    "import type { X } from './x.ts';\nimport { y } from './y.ts';\nexport const n: number = y as number;\n",
  );
  assert.doesNotMatch(output, /import type/);
  assert.doesNotMatch(output, /: number/);
  assert.match(output, /from '\.\/y\.js'/);
});
