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
