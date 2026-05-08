// Exponential backoff with full jitter, honoring Retry-After.

const INITIAL_MS = 500;
const MAX_MS = 8_000;

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

export function backoffDelay(attempt: number, retryAfterSeconds?: number): number {
  if (retryAfterSeconds && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds * 1000, MAX_MS * 4);
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
