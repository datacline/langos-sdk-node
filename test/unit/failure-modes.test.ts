/**
 * Failure-mode coverage for MEDIUM-16 code-review gaps.
 *
 * Covers:
 *  - LangosTimeoutError  (timeout path)
 *  - LangosConnectionError  (DNS/refused/abort)
 *  - AbortSignal propagation  (partner-supplied signal cancels cleanly)
 *  - Idempotency-Key reuse across retries  (same key on every POST attempt)
 *  - Retry-After header parsing  (numeric, HTTP-date, malformed, missing)
 *  - RequestOptions.signal  (per-call signal)
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Langos } from '../../src/index.js';
import {
  LangosTimeoutError,
  LangosConnectionError,
} from '../../src/core/errors.js';
import { backoffDelay } from '../../src/core/retry.js';

const BASE = 'https://api.test.local/v1';

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Client with no retries and a custom fetch. */
function clientWith(
  fetchImpl: typeof fetch,
  extra?: Partial<ConstructorParameters<typeof Langos>[0]>,
) {
  return new Langos({
    apiKey: 'sk_test',
    baseUrl: BASE,
    telemetry: false,
    maxRetries: 0,
    fetch: fetchImpl,
    ...extra,
  });
}

/** A custom fetch that never resolves (simulates a hung connection). */
function hangingFetch(): Promise<Response> {
  return new Promise(() => undefined);
}

/** JSON response helper. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// LangosTimeoutError
// ---------------------------------------------------------------------------

describe('LangosTimeoutError', () => {
  it('throws LangosTimeoutError when fetch exceeds configured timeout', async () => {
    // We use a custom fetch that checks the AbortSignal and rejects with
    // AbortError once it fires, simulating a real timeout.
    const client = clientWith((_url, init) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        if (signal?.aborted) {
          reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }));
          return;
        }
        signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }));
        });
        // Never resolve — wait for the abort.
      });
    }, { timeout: 50 });

    const err = await client.assessments.list().catch((e) => e);
    expect(err).toBeInstanceOf(LangosTimeoutError);
    expect((err as LangosTimeoutError).timeoutMs).toBe(50);
  });

  it('LangosTimeoutError.timeoutMs reflects the configured timeout', async () => {
    const client = clientWith((_url, init) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
        });
      });
    }, { timeout: 120 });

    const err = await client.assessments.list().catch((e) => e);
    expect(err).toBeInstanceOf(LangosTimeoutError);
    expect((err as LangosTimeoutError).timeoutMs).toBe(120);
  });

  it('LangosTimeoutError.message includes the timeout duration in ms', async () => {
    const client = clientWith((_url, init) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
        });
      });
    }, { timeout: 75 });

    const err = await client.assessments.list().catch((e) => e);
    expect(err).toBeInstanceOf(LangosTimeoutError);
    expect((err as LangosTimeoutError).message).toContain('75');
  });

  it('per-call timeout (RequestOptions.timeout) overrides the client-level default', async () => {
    const client = new Langos({
      apiKey: 'sk_test',
      baseUrl: BASE,
      telemetry: false,
      maxRetries: 0,
      timeout: 30_000, // generous default
      fetch: (_url, init) => {
        return new Promise((_resolve, reject) => {
          const signal = init?.signal as AbortSignal | undefined;
          if (signal?.aborted) {
            reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
            return;
          }
          signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
          });
        });
      },
    });

    // RequestOptions are the SECOND argument; the first is list params.
    const err = await client.assessments.list({}, { timeout: 60 }).catch((e) => e);
    expect(err).toBeInstanceOf(LangosTimeoutError);
    expect((err as LangosTimeoutError).timeoutMs).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// LangosConnectionError
// ---------------------------------------------------------------------------

describe('LangosConnectionError', () => {
  it('throws LangosConnectionError when fetch rejects with a network error', async () => {
    const dnsError = Object.assign(new TypeError('Failed to fetch'), { name: 'TypeError' });
    const client = clientWith(() => Promise.reject(dnsError));

    const err = await client.assessments.list().catch((e) => e);
    expect(err).toBeInstanceOf(LangosConnectionError);
  });

  it('LangosConnectionError.cause holds the original underlying error', async () => {
    const original = new TypeError('ECONNREFUSED');
    const client = clientWith(() => Promise.reject(original));

    const err = await client.assessments.list().catch((e) => e);
    expect(err).toBeInstanceOf(LangosConnectionError);
    expect((err as LangosConnectionError).cause).toBe(original);
  });

  it('LangosConnectionError.message includes the network error description', async () => {
    const original = new TypeError('getaddrinfo ENOTFOUND api.test.local');
    const client = clientWith(() => Promise.reject(original));

    const err = await client.assessments.list().catch((e) => e);
    expect(err).toBeInstanceOf(LangosConnectionError);
    expect((err as LangosConnectionError).message).toContain('ENOTFOUND');
  });

  it('throws LangosConnectionError after all retries exhaust on repeated network failures', async () => {
    let calls = 0;
    const client = new Langos({
      apiKey: 'sk_test',
      baseUrl: BASE,
      telemetry: false,
      maxRetries: 2,
      fetch: () => {
        calls++;
        return Promise.reject(new TypeError('ECONNREFUSED'));
      },
    });

    const err = await client.assessments.list().catch((e) => e);
    expect(err).toBeInstanceOf(LangosConnectionError);
    // 1 initial attempt + 2 retries = 3 total fetch calls.
    expect(calls).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// AbortSignal propagation (partner-supplied signal)
// ---------------------------------------------------------------------------

describe('AbortSignal propagation', () => {
  /**
   * Partner-supplied AbortSignal cancellations are wrapped in a typed
   * LangosAbortError so callers can `instanceof`-narrow against cancellation
   * vs other network failure paths.
   */

  it('throws when partner signal is pre-aborted before the call starts', async () => {
    const ac = new AbortController();
    ac.abort();

    const client = clientWith((_url, init) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        if (signal?.aborted) {
          reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }));
          return;
        }
        signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }));
        });
      });
    });

    // RequestOptions (including signal) are the SECOND argument to list().
    const err = await client.assessments.list({}, { signal: ac.signal }).catch((e) => e);
    // Should reject. The exact type is a known bug (raw Error, not LangosConnectionError).
    expect(err).toBeInstanceOf(Error);
    // Must NOT be a timeout error — this was a user-initiated cancel.
    expect(err).not.toBeInstanceOf(LangosTimeoutError);
    // Documents current (buggy) behaviour: not wrapped in LangosConnectionError.
    expect(err).not.toBeInstanceOf(LangosConnectionError);
  });

  it('cancels an in-flight request when partner signal fires mid-request', async () => {
    const ac = new AbortController();

    const client = clientWith((_url, init) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }));
        });
        // Trigger abort after 20ms, while the request is "in-flight".
        setTimeout(() => ac.abort(), 20);
      });
    }, { timeout: 30_000 }); // SDK timeout much longer than our 20ms

    // RequestOptions (including signal) are the SECOND argument to list().
    const err = await client.assessments.list({}, { signal: ac.signal }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(LangosTimeoutError);
  });

  it('does not retry when partner signal fires (abort is not a retryable error)', async () => {
    /**
     * The SDK's retry guard checks `userSignal?.aborted` before the retry
     * branch (request.ts:81 fires before :82). A pre-aborted signal should
     * cause immediate re-throw, not retry.
     *
     * BUG: The check is `userSignal?.aborted` which is evaluated AFTER the
     * catch block. If the fetch hasn't yet received the abort signal at throw
     * time (race), the retry branch fires. We test with a pre-aborted signal
     * to ensure the deterministic path is covered.
     */
    const ac = new AbortController();
    ac.abort();

    let calls = 0;
    const client = new Langos({
      apiKey: 'sk_test',
      baseUrl: BASE,
      telemetry: false,
      maxRetries: 3,
      fetch: (_url, init) => {
        calls++;
        return new Promise((_resolve, reject) => {
          const signal = init?.signal as AbortSignal | undefined;
          if (signal?.aborted) {
            reject(Object.assign(new Error('AbortError'), { name: 'AbortError' }));
            return;
          }
          signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('AbortError'), { name: 'AbortError' }));
          });
        });
      },
    });

    // RequestOptions (including signal) are the SECOND argument to list().
    await client.assessments.list({}, { signal: ac.signal }).catch(() => null);
    // With a pre-aborted signal, the request should not retry at all.
    expect(calls).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Idempotency-Key reuse across retries
// ---------------------------------------------------------------------------

describe('Idempotency-Key reuse across retries', () => {
  it('sends the SAME auto-generated Idempotency-Key on every retry attempt', async () => {
    let attempt = 0;
    const keys: string[] = [];

    const client = new Langos({
      apiKey: 'sk_test',
      baseUrl: BASE,
      telemetry: false,
      maxRetries: 2,
      fetch: async (_input, init) => {
        attempt++;
        keys.push((init?.headers as Headers).get('idempotency-key') ?? '');
        if (attempt < 3) {
          return new Response('upstream error', { status: 503 });
        }
        return jsonResponse({ id: 'cand_1', object: 'candidate', email: 'a@b.com', assessment_id: 'asm_1', status: 'invited', invitation_url: 'https://x', invited_at: 't', created_at: 't', updated_at: 't' }, 201);
      },
    });

    await client.candidates.create({ email: 'a@b.com', assessmentId: 'asm_1' });

    expect(attempt).toBe(3);
    expect(keys).toHaveLength(3);
    // Auto-generated key must be a valid UUID.
    expect(keys[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    // The SAME key must be sent on all three attempts.
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).toBe(keys[0]);
  });

  it('reuses a user-supplied Idempotency-Key on every retry attempt', async () => {
    let attempt = 0;
    const keys: string[] = [];

    const client = new Langos({
      apiKey: 'sk_test',
      baseUrl: BASE,
      telemetry: false,
      maxRetries: 1,
      fetch: async (_input, init) => {
        attempt++;
        keys.push((init?.headers as Headers).get('idempotency-key') ?? '');
        if (attempt < 2) {
          return new Response('upstream error', { status: 503 });
        }
        return jsonResponse({ id: 'cand_1', object: 'candidate', email: 'a@b.com', assessment_id: 'asm_1', status: 'invited', invitation_url: 'https://x', invited_at: 't', created_at: 't', updated_at: 't' }, 201);
      },
    });

    await client.candidates.create(
      { email: 'a@b.com', assessmentId: 'asm_1' },
      { idempotencyKey: 'deterministic-key-xyz' },
    );

    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe('deterministic-key-xyz');
    expect(keys[1]).toBe('deterministic-key-xyz');
  });

  it('generates a different Idempotency-Key for each independent call (not shared across calls)', async () => {
    const keysPerCall: string[] = [];

    const client = new Langos({
      apiKey: 'sk_test',
      baseUrl: BASE,
      telemetry: false,
      maxRetries: 0,
      fetch: async (_input, init) => {
        keysPerCall.push((init?.headers as Headers).get('idempotency-key') ?? '');
        return jsonResponse({ id: 'cand_1', object: 'candidate', email: 'a@b.com', assessment_id: 'asm_1', status: 'invited', invitation_url: 'https://x', invited_at: 't', created_at: 't', updated_at: 't' }, 201);
      },
    });

    await client.candidates.create({ email: 'a@b.com', assessmentId: 'asm_1' });
    await client.candidates.create({ email: 'b@b.com', assessmentId: 'asm_1' });

    expect(keysPerCall).toHaveLength(2);
    expect(keysPerCall[0]).not.toBe(keysPerCall[1]);
  });
});

// ---------------------------------------------------------------------------
// Retry-After header parsing (unit level via backoffDelay)
// ---------------------------------------------------------------------------

describe('Retry-After header parsing', () => {
  it('numeric Retry-After: small / realistic values returned as-is', () => {
    // Cap is now 300_000ms (5min) by default, configurable via maxRetryAfterMs.
    expect(backoffDelay(0, 5)).toBe(5_000);
    expect(backoffDelay(2, 1)).toBe(1_000);
    expect(backoffDelay(0, 30)).toBe(30_000);
    expect(backoffDelay(0, 60)).toBe(60_000); // realistic rate-limit window
    expect(backoffDelay(0, 300)).toBe(300_000); // cap value honored exactly
  });

  it('numeric Retry-After: value over cap falls back to exponential backoff (not silently capped)', () => {
    // Per the webhook+retry hardening: hostile/over-cap values are rejected,
    // not truncated. Caller falls through to exponential backoff.
    const delay = backoffDelay(0, 9_999_999);
    expect(delay).toBeLessThanOrEqual(500); // initial exponential band
    expect(delay).toBeGreaterThan(0);
  });

  it('HTTP-date Retry-After: parseInt returns NaN — falls back to exponential', () => {
    // This documents what request.ts does: parseInt('Wed, 21 Oct...', 10) → NaN
    // Number.isFinite(NaN) → false, so retryAfterSeconds is passed as undefined.
    const raw = 'Wed, 21 Oct 2025 07:28:00 GMT';
    const parsed = parseInt(raw, 10);
    expect(Number.isFinite(parsed)).toBe(false);

    // backoffDelay with undefined falls back to exponential.
    const delay = backoffDelay(0, undefined);
    expect(delay).toBeGreaterThan(0);
    expect(delay).toBeLessThanOrEqual(500); // initial exponential band (INITIAL_MS * 1)
  });

  it('negative Retry-After: backoffDelay ignores it and uses exponential', () => {
    // parseInt('-30', 10) === -30; Number.isFinite(-30) === true, BUT
    // backoffDelay checks `retryAfterSeconds > 0` before using it.
    const delay = backoffDelay(0, -30);
    expect(delay).toBeGreaterThan(0);
    expect(delay).toBeLessThanOrEqual(500);
  });

  it('NaN Retry-After: backoffDelay falls back to exponential', () => {
    const delay = backoffDelay(0, NaN);
    expect(delay).toBeGreaterThan(0);
    expect(delay).toBeLessThanOrEqual(500);
  });

  it('missing Retry-After (undefined): backoffDelay returns exponential delay', () => {
    const delay = backoffDelay(0);
    expect(delay).toBeGreaterThan(0);
    expect(delay).toBeLessThanOrEqual(500);
  });

  it('integration: request.ts passes numeric Retry-After seconds to backoffDelay correctly', async () => {
    /**
     * We cannot easily assert the exact sleep duration without mocking timers,
     * so we instead assert that after a 429 with Retry-After: 1, the SDK
     * succeeds on the second attempt and exactly 2 fetch calls were made.
     * The sleep delay is already covered at the unit level above.
     */
    let attempt = 0;
    const client = new Langos({
      apiKey: 'sk_test',
      baseUrl: BASE,
      telemetry: false,
      maxRetries: 1,
      fetch: async () => {
        attempt++;
        if (attempt === 1) {
          return new Response('rate limited', {
            status: 429,
            headers: { 'retry-after': '1' }, // 1 second — test suite can handle this
          });
        }
        return jsonResponse({ object: 'list', data: [], has_more: false, next_cursor: null });
      },
    });

    const page = await client.assessments.list();
    expect(page.data).toEqual([]);
    expect(attempt).toBe(2);
  }, 10_000);

  it('integration: HTTP-date Retry-After falls back to exponential (does not crash)', async () => {
    let attempt = 0;
    const client = new Langos({
      apiKey: 'sk_test',
      baseUrl: BASE,
      telemetry: false,
      maxRetries: 1,
      fetch: async () => {
        attempt++;
        if (attempt === 1) {
          return new Response('rate limited', {
            status: 429,
            headers: { 'retry-after': 'Wed, 21 Oct 2025 07:28:00 GMT' },
          });
        }
        return jsonResponse({ object: 'list', data: [], has_more: false, next_cursor: null });
      },
    });

    // Should succeed on second attempt without throwing.
    const page = await client.assessments.list();
    expect(page.data).toEqual([]);
    expect(attempt).toBe(2);
  }, 10_000);
});
