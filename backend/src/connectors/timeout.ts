/** Our own request timeout; recognisable so the host can be marked unreachable. */
export class UpstreamTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs} ms`);
    this.name = 'UpstreamTimeoutError';
  }
}

/**
 * Runs `task` with an AbortSignal that fires after `timeoutMs`. The timer is
 * always cleared afterwards, so a finished request leaves nothing behind.
 */
export async function withTimeout<T>(
  timeoutMs: number,
  task: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new UpstreamTimeoutError(timeoutMs));
  }, timeoutMs);
  try {
    return await task(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}
