const MAX_DELAY_MS = 120000;

export function retryDelayMs(error, retryIndex, random = Math.random) {
  if (Number.isFinite(error?.retryAfterMs) && error.retryAfterMs >= 0)
    return Math.min(MAX_DELAY_MS, error.retryAfterMs);
  const base = Math.min(MAX_DELAY_MS, 800 * 2 ** Math.max(0, retryIndex));
  return Math.min(MAX_DELAY_MS, Math.round(base * (0.75 + random() * 0.5)));
}

/** Wait in short slices so pause, cancellation, and unload take effect promptly. */
export async function waitForRetry(delayMs, shouldContinue, sleep = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  let remaining = Math.max(0, Math.min(MAX_DELAY_MS, delayMs));
  while (remaining > 0) {
    if (!shouldContinue()) return false;
    const slice = Math.min(200, remaining);
    await sleep(slice);
    remaining -= slice;
  }
  return shouldContinue();
}

/** Retry only provider failures explicitly classified as known transient failures. */
export async function withRecoverableRetries(operation, options = {}) {
  const retries = Math.max(0, Math.min(5, Math.floor(Number(options.retries) || 0)));
  const shouldContinue = options.shouldContinue ?? (() => true);
  const sleep = options.sleep;
  const random = options.random;
  let retryIndex = 0;
  while (shouldContinue()) {
    try {
      return await operation(retryIndex);
    } catch (error) {
      if (error?.retryable !== true || retryIndex >= retries) throw error;
      if (!shouldContinue()) return null;
      const delayMs = retryDelayMs(error, retryIndex, random);
      options.onRetry?.(retryIndex + 1, delayMs);
      if (!await waitForRetry(delayMs, shouldContinue, sleep)) return null;
      retryIndex++;
    }
  }
  return null;
}
