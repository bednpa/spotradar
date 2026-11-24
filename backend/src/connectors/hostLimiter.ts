/**
 * Runs tasks for the same host one after another (max 1 concurrent request per
 * host) while different hosts proceed in parallel. Failures do not block the queue.
 */
export interface HostLimiter {
  run<T>(host: string, task: () => Promise<T>): Promise<T>;
}

export function createHostLimiter(): HostLimiter {
  const tails = new Map<string, Promise<unknown>>();
  return {
    run<T>(host: string, task: () => Promise<T>): Promise<T> {
      const previous = tails.get(host) ?? Promise.resolve();
      const result = previous.then(task, task);
      const tail = result.then(
        () => undefined,
        () => undefined,
      );
      tails.set(host, tail);
      void tail.then(() => {
        if (tails.get(host) === tail) tails.delete(host);
      });
      return result;
    },
  };
}
