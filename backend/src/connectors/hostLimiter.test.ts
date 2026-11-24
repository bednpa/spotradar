import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createHostLimiter } from './hostLimiter.ts';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('createHostLimiter', () => {
  it('runs tasks of the same host one at a time, in order', async () => {
    const limiter = createHostLimiter();
    const log: string[] = [];
    const gate = deferred();
    const first = limiter.run('a.cz', async () => {
      log.push('first start');
      await gate.promise;
      log.push('first end');
    });
    const second = limiter.run('a.cz', () => {
      log.push('second start');
      return Promise.resolve();
    });
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(log, ['first start']);
    gate.resolve();
    await Promise.all([first, second]);
    assert.deepEqual(log, ['first start', 'first end', 'second start']);
  });

  it('runs different hosts in parallel', async () => {
    const limiter = createHostLimiter();
    const gate = deferred();
    let otherRan = false;
    const blocked = limiter.run('a.cz', () => gate.promise);
    await limiter.run('b.cz', () => {
      otherRan = true;
      return Promise.resolve();
    });
    assert.equal(otherRan, true);
    gate.resolve();
    await blocked;
  });

  it('keeps going after a failed task', async () => {
    const limiter = createHostLimiter();
    const failed = limiter.run('a.cz', () => Promise.reject(new Error('boom')));
    const ok = limiter.run('a.cz', () => Promise.resolve(42));
    await assert.rejects(failed, /boom/);
    assert.equal(await ok, 42);
  });
});
