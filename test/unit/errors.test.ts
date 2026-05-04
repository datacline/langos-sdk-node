import { describe, it, expect } from 'vitest';
import {
  LangosAPIError,
  LangosAuthenticationError,
  LangosForbiddenError,
  LangosNotFoundError,
  LangosBadRequestError,
  LangosConflictError,
  LangosRateLimitError,
  LangosServerError,
} from '../../src/core/errors.js';

function headers(init: Record<string, string> = {}): Headers {
  const h = new Headers();
  for (const [k, v] of Object.entries(init)) h.set(k, v);
  return h;
}

describe('LangosAPIError.from', () => {
  it('maps 401 to LangosAuthenticationError', () => {
    const err = LangosAPIError.from(401, { code: 'unauthorized', detail: 'bad key' }, headers());
    expect(err).toBeInstanceOf(LangosAuthenticationError);
    expect(err).toBeInstanceOf(LangosAPIError);
    expect(err.status).toBe(401);
    expect(err.code).toBe('unauthorized');
    expect(err.message).toBe('bad key');
  });

  it('maps 403 to LangosForbiddenError', () => {
    const err = LangosAPIError.from(403, { code: 'insufficient_scope' }, headers());
    expect(err).toBeInstanceOf(LangosForbiddenError);
  });

  it('maps 404 to LangosNotFoundError', () => {
    const err = LangosAPIError.from(404, {}, headers());
    expect(err).toBeInstanceOf(LangosNotFoundError);
  });

  it('maps 400 and 422 to LangosBadRequestError with field errors', () => {
    const err = LangosAPIError.from(
      422,
      { errors: [{ field: 'email', message: 'required' }] },
      headers(),
    );
    expect(err).toBeInstanceOf(LangosBadRequestError);
    expect(err.errors).toEqual([{ field: 'email', message: 'required' }]);
  });

  it('maps 409 to LangosConflictError', () => {
    const err = LangosAPIError.from(409, {}, headers());
    expect(err).toBeInstanceOf(LangosConflictError);
  });

  it('maps 429 to LangosRateLimitError with retryAfter', () => {
    const err = LangosAPIError.from(429, {}, headers({ 'retry-after': '12' }));
    expect(err).toBeInstanceOf(LangosRateLimitError);
    expect((err as InstanceType<typeof LangosRateLimitError>).retryAfter).toBe(12);
  });

  it('maps 500 to LangosServerError', () => {
    const err = LangosAPIError.from(503, {}, headers());
    expect(err).toBeInstanceOf(LangosServerError);
  });

  it('captures requestId from body or header', () => {
    const fromBody = LangosAPIError.from(404, { request_id: 'req_body' }, headers());
    expect(fromBody.requestId).toBe('req_body');
    const fromHeader = LangosAPIError.from(404, {}, headers({ 'x-request-id': 'req_hdr' }));
    expect(fromHeader.requestId).toBe('req_hdr');
  });
});

describe('LangosAPIError typed details', () => {
  it('quotaDetails: returns structured payload on 402 quota_exceeded', () => {
    const err = LangosAPIError.from(
      402,
      {
        code: 'quota_exceeded',
        detail: 'Account is over quota: 30/30 sessions this period',
        sessions_used: 30,
        sessions_limit: 30,
        reset_at: '2026-06-01T00:00:00.000Z',
        upgrade_url: 'https://app.langos.io/settings/billing',
        plan_tier: 'mid_tier',
      },
      headers(),
    );
    expect(err.quotaDetails).toEqual({
      sessions_used: 30,
      sessions_limit: 30,
      reset_at: '2026-06-01T00:00:00.000Z',
      upgrade_url: 'https://app.langos.io/settings/billing',
      plan_tier: 'mid_tier',
    });
    // The 402 path is not specialised — it still surfaces as the base APIError.
    expect(err).toBeInstanceOf(LangosAPIError);
    expect(err.status).toBe(402);
  });

  it('quotaDetails: null when status is not 402', () => {
    const err = LangosAPIError.from(403, { code: 'quota_exceeded' }, headers());
    expect(err.quotaDetails).toBeNull();
  });

  it('quotaDetails: null when code does not match', () => {
    const err = LangosAPIError.from(402, { code: 'payment_required' }, headers());
    expect(err.quotaDetails).toBeNull();
  });

  it('featureDetails: returns structured payload on 403 feature_not_available', () => {
    const err = LangosAPIError.from(
      403,
      {
        code: 'feature_not_available',
        detail: 'replay is not included in your plan',
        feature: 'replay',
        upgrade_url: 'https://app.langos.io/settings/billing',
      },
      headers(),
    );
    expect(err.featureDetails).toEqual({
      feature: 'replay',
      upgrade_url: 'https://app.langos.io/settings/billing',
    });
  });

  it('featureDetails: null when code does not match', () => {
    const err = LangosAPIError.from(403, { code: 'insufficient_scope' }, headers());
    expect(err.featureDetails).toBeNull();
  });
});
