import { AccountResource } from './resources/account.js';
import { AssessmentsResource } from './resources/assessments.js';
import { CandidatesResource } from './resources/candidates.js';
import { SessionsResource } from './resources/sessions.js';
import { Webhooks } from './resources/webhooks.js';
import { noopLogger } from './core/logger.js';
import type { ResolvedClientConfig } from './core/request.js';
import type { LangosOptions } from './types.js';

const DEFAULT_BASE_URL = 'https://app.langos.io/api/v1';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;

export class Langos {
  readonly account: AccountResource;
  readonly assessments: AssessmentsResource;
  readonly candidates: CandidatesResource;
  readonly sessions: SessionsResource;

  /**
   * Webhook signature helpers (`Langos.webhooks.constructEvent`). Static-style:
   * does not need the client instance, since signing is independent of API
   * calls. Exposed both as a class member and as `Langos.webhooks` for parity
   * with Stripe's `stripe.webhooks` style.
   */
  readonly webhooks = Webhooks;
  static readonly webhooks = Webhooks;

  private readonly cfg: ResolvedClientConfig;

  constructor(options: LangosOptions) {
    if (!options.apiKey) {
      throw new Error(
        'Langos: missing apiKey. Pass via constructor or set LANGOS_API_KEY environment variable and read it.',
      );
    }
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (!fetchImpl) {
      throw new Error(
        'Langos: no fetch implementation found. Use Node 18+ or pass `fetch` via the options.',
      );
    }
    if (options.appName !== undefined) {
      assertHeaderSafe('appName', options.appName);
    }
    if (options.apiKey !== undefined) {
      // apiKey is also reflected into a header (Authorization: Bearer …) — same
      // CRLF-injection class applies. Belt-and-braces: even though most callers
      // pull this from env, validate once here.
      assertHeaderSafe('apiKey', options.apiKey);
    }
    this.cfg = {
      apiKey: options.apiKey,
      baseUrl: (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, ''),
      timeout: options.timeout ?? DEFAULT_TIMEOUT_MS,
      maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
      fetchImpl,
      logger: options.logger ?? noopLogger,
      appName: options.appName,
      telemetry: options.telemetry !== false,
    };

    this.account = new AccountResource(this.cfg);
    this.assessments = new AssessmentsResource(this.cfg);
    this.candidates = new CandidatesResource(this.cfg);
    this.sessions = new SessionsResource(this.cfg);
  }
}

// CRLF / null-byte / C0-control characters in a partner-supplied string that
// lands in an HTTP header enables header-injection (e.g. an attacker who can
// control `appName` could splice in `\r\nX-Spoofed: yes`). Reject at construct
// time with a clear error rather than relying on the underlying fetch impl,
// which on some runtimes silently truncates or normalizes invalid headers.
const HEADER_UNSAFE = /[\r\n\0\x00-\x1f\x7f]/;

function assertHeaderSafe(field: string, value: string): void {
  if (typeof value !== 'string') {
    throw new TypeError(`Langos: ${field} must be a string`);
  }
  if (HEADER_UNSAFE.test(value)) {
    throw new TypeError(
      `Langos: ${field} contains control characters (\\r, \\n, \\0, or other C0). ` +
        'These are not allowed in HTTP headers and would enable header injection.',
    );
  }
}
