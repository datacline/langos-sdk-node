// Exponential backoff with full jitter, honoring Retry-After.

const INITIAL_MS = 500;
const MAX_MS = 8_000;
// Default ceiling on Retry-After. Real-world rate-limit windows commonly run
// 60–300s; capping below that defeats the header (we'd retry early, eat the
// 429 again, and burn the partner's budget). 5 minutes is a sensible upper
// bound — anything higher and partners almost always want to surface the
// error to their caller rather than block the request that long. Configurable
// per-client via `LangosOptions.maxRetryAfterMs`.
export const DEFAULT_MAX_RETRY_AFTER_MS = 300_000;

export function shouldRetry(status: number | null, isNetworkError: boolean): boolean {
  if (isNetworkError) return true;
  if (status === null) return false;
  // 409 Conflict is intentionally NOT retried. It signals a non-idempotent
  // failure mode (duplicate email, version conflict, race against a parallel
  // mutation) where retrying just burns the partner's rate-limit budget and
  // amplifies the conflict. Partners should surface 409 to their caller and
  // resolve the conflict explicitly.
  if (status === 408 || status === 429) return true;
  if (status >= 500 && status !== 501) return true;
  return false;
}

/**
 * Compute the delay before the next retry attempt.
 *
 * Honors `Retry-After` (in seconds) when the server emits a sane value:
 *   - finite, non-negative
 *   - <= `maxRetryAfterMs` once converted to ms
 *
 * Anything else (NaN, negative, absurdly large, malformed HTTP-date) is
 * ignored and we fall back to exponential-with-jitter. The fallback is the
 * safer default — a hostile or buggy server can't trick the SDK into
 * sleeping for hours by emitting `Retry-After: 99999999`.
 *
 * NOTE: HTTP-date Retry-After (RFC 7231) is NOT parsed here. The server-side
 * rate-limit middleware emits delta-seconds and that is the only format we
 * commit to honoring. If we ever start receiving HTTP-date from an upstream
 * proxy, the value will fail the finiteness check and we'll fall through to
 * backoff — which is correct, just not optimal.
 */
export function backoffDelay(
  attempt: number,
  retryAfterSeconds?: number,
  maxRetryAfterMs: number = DEFAULT_MAX_RETRY_AFTER_MS,
): number {
  if (
    retryAfterSeconds !== undefined &&
    Number.isFinite(retryAfterSeconds) &&
    retryAfterSeconds >= 0
  ) {
    const requestedMs = retryAfterSeconds * 1000;
    if (requestedMs <= maxRetryAfterMs) {
      return requestedMs;
    }
    // Server asked for a wait longer than our cap — fall through to backoff
    // rather than silently honoring an attacker-controlled "sleep for an
    // hour" value. Returning the cap would also be defensible, but the
    // partner is better served by a fast retry + a 429 they can surface.
  }
  const base = Math.min(INITIAL_MS * Math.pow(2, attempt), MAX_MS);
  return Math.floor(base * (0.5 + Math.random() * 0.5));
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(abortError());
      },
      { once: true },
    );
  });
}

function abortError(): Error {
  const e = new Error('Aborted');
  e.name = 'AbortError';
  return e;
}
