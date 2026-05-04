import { describe, it, expect } from 'vitest';
import { shouldAddIdempotencyKey, newIdempotencyKey } from '../../src/core/idempotency.js';

describe('idempotency', () => {
  it('adds key on POST/PATCH/DELETE/PUT when none supplied', () => {
    expect(shouldAddIdempotencyKey('POST', false)).toBe(true);
    expect(shouldAddIdempotencyKey('PATCH', false)).toBe(true);
    expect(shouldAddIdempotencyKey('DELETE', false)).toBe(true);
    expect(shouldAddIdempotencyKey('PUT', false)).toBe(true);
  });
  it('does not add key on GET/HEAD/OPTIONS', () => {
    expect(shouldAddIdempotencyKey('GET', false)).toBe(false);
    expect(shouldAddIdempotencyKey('HEAD', false)).toBe(false);
    expect(shouldAddIdempotencyKey('OPTIONS', false)).toBe(false);
  });
  it('respects user-supplied key', () => {
    expect(shouldAddIdempotencyKey('POST', true)).toBe(false);
  });
  it('generates RFC 4122 UUIDs', () => {
    const key = newIdempotencyKey();
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(newIdempotencyKey()).not.toBe(key);
  });
});
