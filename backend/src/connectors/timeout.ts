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
    controller.abort(new Error(`Request timed out after ${timeoutMs} ms`));
  }, timeoutMs);
  try {
    return await task(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}
