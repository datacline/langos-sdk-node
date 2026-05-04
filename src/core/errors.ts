// Error hierarchy for the Langos SDK. All non-network errors thrown by the
// client extend `LangosError`. Partners should catch the most specific subclass
// they care about and let the rest bubble.

/**
 * Structured details merged into the 402 `quota_exceeded` error body. The
 * server emits these as top-level fields alongside the standard problem+json
 * envelope; partners can render an upgrade prompt without parsing free-form
 * text.
 */
export interface QuotaExceededDetails {
  sessions_used: number;
  sessions_limit: number;
  /** ISO timestamp when the quota window resets. */
  reset_at: string;
  /** Absolute URL to the upgrade page; `null` if the server can't build one. */
  upgrade_url: string | null;
  /** The plan tier that hit the cap (e.g. `mid_tier`, `growth`). */
  plan_tier: string;
}

/**
 * Structured details merged into the 403 `feature_not_available` error body.
 * Returned when an integration calls a feature its plan tier does not include
 * (e.g. asking for replay on `starter`).
 */
export interface FeatureNotAvailableDetails {
  /** The plan-features key that is gated off (e.g. `replay`, `ai_assistance`). */
  feature: string;
  /** Absolute URL to the upgrade page; `null` if the server can't build one. */
  upgrade_url: string | null;
}

export interface LangosErrorBody {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  code?: string;
  request_id?: string;
  errors?: Array<{ field: string; message: string; code?: string }>;
  // Loose extras: the server merges code-specific fields (quota details,
  // feature-gate details) at the top level of the problem+json body. Use
  // {@link LangosAPIError.quotaDetails} / `featureDetails` to access them
  // type-safely instead of reaching into `body` directly.
  [extra: string]: unknown;
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

  /**
   * Typed accessor for 402 `quota_exceeded` errors. Returns the structured
   * details payload (sessions used/limit, reset timestamp, upgrade URL, plan
   * tier) when the error matches; otherwise `null`.
   *
   * Use this instead of reaching into `err.body` to render upgrade prompts.
   */
  get quotaDetails(): QuotaExceededDetails | null {
    if (this.status !== 402 || this.code !== 'quota_exceeded' || !this.body) return null;
    const b = this.body as Record<string, unknown>;
    if (typeof b.sessions_used !== 'number' || typeof b.sessions_limit !== 'number') return null;
    return {
      sessions_used: b.sessions_used,
      sessions_limit: b.sessions_limit,
      reset_at: typeof b.reset_at === 'string' ? b.reset_at : '',
      upgrade_url: typeof b.upgrade_url === 'string' ? b.upgrade_url : null,
      plan_tier: typeof b.plan_tier === 'string' ? b.plan_tier : '',
    };
  }

  /**
   * Typed accessor for 403 `feature_not_available` errors. Returns the gated
   * feature key and an upgrade URL; otherwise `null`.
   */
  get featureDetails(): FeatureNotAvailableDetails | null {
    if (this.status !== 403 || this.code !== 'feature_not_available' || !this.body) return null;
    const b = this.body as Record<string, unknown>;
    if (typeof b.feature !== 'string') return null;
    return {
      feature: b.feature,
      upgrade_url: typeof b.upgrade_url === 'string' ? b.upgrade_url : null,
    };
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
