// Error hierarchy for the Langos SDK. All non-network errors thrown by the
// client extend `LangosError`. Partners should catch the most specific subclass
// they care about and let the rest bubble.

export interface LangosErrorBody {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  code?: string;
  request_id?: string;
  errors?: Array<{ field: string; message: string; code?: string }>;
}

export class LangosError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LangosError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown when an HTTP response is received and indicates an error (>= 400). */
export class LangosAPIError extends LangosError {
  readonly status: number;
  readonly code: string | undefined;
  readonly requestId: string | undefined;
  readonly headers: Headers;
  readonly body: LangosErrorBody | undefined;
  readonly errors: LangosErrorBody['errors'] | undefined;

  constructor(
    status: number,
    body: LangosErrorBody | undefined,
    headers: Headers,
    fallbackMessage: string,
  ) {
    super(body?.detail || body?.title || fallbackMessage);
    this.name = 'LangosAPIError';
    this.status = status;
    this.code = body?.code;
    this.requestId = body?.request_id || headers.get('x-request-id') || undefined;
    this.headers = headers;
    this.body = body;
    this.errors = body?.errors;
  }

  static from(status: number, body: unknown, headers: Headers): LangosAPIError {
    const parsed: LangosErrorBody | undefined =
      body && typeof body === 'object' ? (body as LangosErrorBody) : undefined;
    switch (status) {
      case 400:
        return new LangosBadRequestError(status, parsed, headers, 'Bad Request');
      case 401:
        return new LangosAuthenticationError(status, parsed, headers, 'Unauthorized');
      case 403:
        return new LangosForbiddenError(status, parsed, headers, 'Forbidden');
      case 404:
        return new LangosNotFoundError(status, parsed, headers, 'Not Found');
      case 409:
        return new LangosConflictError(status, parsed, headers, 'Conflict');
      case 422:
        return new LangosBadRequestError(status, parsed, headers, 'Unprocessable Entity');
      case 429: {
        const retryAfterRaw = headers.get('retry-after');
        const retryAfter = retryAfterRaw ? parseInt(retryAfterRaw, 10) : undefined;
        return new LangosRateLimitError(
          status,
          parsed,
          headers,
          'Rate limit exceeded',
          Number.isFinite(retryAfter) ? (retryAfter as number) : undefined,
        );
      }
      default:
        if (status >= 500) {
          return new LangosServerError(status, parsed, headers, 'Server Error');
        }
        return new LangosAPIError(status, parsed, headers, `HTTP ${status}`);
    }
  }
}

function tagged<T extends new (...args: any[]) => Error>(Cls: T, tag: string) {
  return class extends Cls {
    constructor(...args: any[]) {
      super(...args);
      this.name = tag;
    }
  };
}

export const LangosAuthenticationError = tagged(LangosAPIError, 'LangosAuthenticationError');
export const LangosForbiddenError = tagged(LangosAPIError, 'LangosForbiddenError');
export const LangosNotFoundError = tagged(LangosAPIError, 'LangosNotFoundError');
export const LangosBadRequestError = tagged(LangosAPIError, 'LangosBadRequestError');
export const LangosConflictError = tagged(LangosAPIError, 'LangosConflictError');
export const LangosServerError = tagged(LangosAPIError, 'LangosServerError');

export type LangosAuthenticationError = LangosAPIError;
export type LangosForbiddenError = LangosAPIError;
export type LangosNotFoundError = LangosAPIError;
export type LangosBadRequestError = LangosAPIError;
export type LangosConflictError = LangosAPIError;
export type LangosServerError = LangosAPIError;

export class LangosRateLimitError extends LangosAPIError {
  readonly retryAfter: number | undefined;

  constructor(
    status: number,
    body: LangosErrorBody | undefined,
    headers: Headers,
    fallback: string,
    retryAfter: number | undefined,
  ) {
    super(status, body, headers, fallback);
    this.name = 'LangosRateLimitError';
    this.retryAfter = retryAfter;
  }
}

/** Thrown when the underlying fetch fails (DNS, TCP, TLS). */
export class LangosConnectionError extends LangosError {
  readonly cause: unknown;
  constructor(message: string, cause: unknown) {
    super(message);
    this.name = 'LangosConnectionError';
    this.cause = cause;
  }
}

/** Thrown when a request exceeds the configured timeout. */
export class LangosTimeoutError extends LangosError {
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`);
    this.name = 'LangosTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/** Thrown by `Langos.webhooks.constructEvent` when signature verification fails. */
export class LangosSignatureVerificationError extends LangosError {
  constructor(reason: string) {
    super(`Webhook signature verification failed: ${reason}`);
    this.name = 'LangosSignatureVerificationError';
  }
}
