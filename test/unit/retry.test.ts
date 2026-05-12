import { describe, it, expect } from 'vitest';
import { shouldRetry, backoffDelay } from '../../src/core/retry.js';

describe('shouldRetry', () => {
  it('retries network errors', () => {
    expect(shouldRetry(null, true)).toBe(true);
  });
  it('retries 408 and 429', () => {
    expect(shouldRetry(408, false)).toBe(true);
    expect(shouldRetry(429, false)).toBe(true);
  });
  it('does NOT retry 409 Conflict (non-idempotent — duplicate email, version conflict)', () => {
    expect(shouldRetry(409, false)).toBe(false);
  });
  it('retries 5xx except 501', () => {
    expect(shouldRetry(500, false)).toBe(true);
    expect(shouldRetry(502, false)).toBe(true);
    expect(shouldRetry(503, false)).toBe(true);
    expect(shouldRetry(504, false)).toBe(true);
    expect(shouldRetry(501, false)).toBe(false);
  });
  it('does not retry 4xx other than the listed', () => {
    expect(shouldRetry(400, false)).toBe(false);
    expect(shouldRetry(401, false)).toBe(false);
    expect(shouldRetry(403, false)).toBe(false);
    expect(shouldRetry(404, false)).toBe(false);
    expect(shouldRetry(409, false)).toBe(false);
    expect(shouldRetry(422, false)).toBe(false);
  });
  it('does not retry 2xx/3xx', () => {
    expect(shouldRetry(200, false)).toBe(false);
    expect(shouldRetry(304, false)).toBe(false);
  });
});

describe('backoffDelay', () => {
  it('honors retry-after when given', () => {
    expect(backoffDelay(0, 5)).toBe(5_000);
    expect(backoffDelay(2, 10)).toBe(10_000);
  });

  it('honors realistic rate-limit Retry-After windows (60s, 300s)', () => {
    // The previous 32s cap silently truncated server values 60s and 300s,
    // defeating the header. New default cap is 5 minutes.
    expect(backoffDelay(0, 60)).toBe(60_000);
    expect(backoffDelay(0, 300)).toBe(300_000);
  });

  it('falls back to backoff when retry-after exceeds the cap (default 5min)', () => {
    // 99_999_999s is ~3 years. Honoring this would block the request
    // forever; fall back to backoff so the partner's caller fast-fails.
    const d = backoffDelay(0, 99_999_999);
    expect(d).toBeLessThanOrEqual(500); // attempt 0: backoff bounded by INITIAL_MS
  });

  it('rejects negative retry-after as nonsensical (falls back to backoff)', () => {
    const d = backoffDelay(0, -10);
    // Falls through to randomized exponential backoff; bounded by INITIAL_MS.
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThanOrEqual(500);
  });

  it('rejects NaN retry-after (falls back to backoff)', () => {
    const d = backoffDelay(0, NaN);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThanOrEqual(500);
  });

  it('uses backoff when retry-after is omitted', () => {
    const d = backoffDelay(0, undefined);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThanOrEqual(500);
  });

  it('honors a configurable per-client maxRetryAfterMs', () => {
    // Caller wants a tighter ceiling — 30s. Server requests 60s. Should
    // fall through to backoff rather than honoring the over-cap value.
    const d = backoffDelay(0, 60, 30_000);
    expect(d).toBeLessThanOrEqual(500); // backoff, not 60_000
    // Within-cap value should still be honored verbatim.
    expect(backoffDelay(0, 20, 30_000)).toBe(20_000);
  });

  it('grows exponentially without retry-after', () => {
    const a = backoffDelay(0);
    const b = backoffDelay(2);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThanOrEqual(500);
    expect(b).toBeGreaterThan(0);
    expect(b).toBeLessThanOrEqual(2_000);
  });
});
