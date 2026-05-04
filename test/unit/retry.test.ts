import { describe, it, expect } from 'vitest';
import { shouldRetry, backoffDelay } from '../../src/core/retry.js';

describe('shouldRetry', () => {
  it('retries network errors', () => {
    expect(shouldRetry(null, true)).toBe(true);
  });
  it('retries 408, 409, 429', () => {
    expect(shouldRetry(408, false)).toBe(true);
    expect(shouldRetry(409, false)).toBe(true);
    expect(shouldRetry(429, false)).toBe(true);
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
  it('caps retry-after at 32_000ms', () => {
    expect(backoffDelay(0, 1_000)).toBeLessThanOrEqual(32_000);
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
