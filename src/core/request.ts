import {
  LangosAPIError,
  LangosAbortError,
  LangosConnectionError,
  LangosResponseFormatError,
  LangosTimeoutError,
} from './errors.js';
import { shouldRetry, backoffDelay, sleep } from './retry.js';
import { shouldAddIdempotencyKey, newIdempotencyKey } from './idempotency.js';
import { noopLogger } from './logger.js';
import type { Logger, RequestOptions } from '../types.js';
import { version } from './version.js';

export interface ResolvedClientConfig {
  apiKey: string;
  baseUrl: string;
  timeout: number;
  maxRetries: number;
  maxRetryAfterMs: number;
  fetchImpl: typeof fetch;
  logger: Logger;
  appName: string | undefined;
  telemetry: boolean;
}

export interface InternalRequest {
  method: string;
  path: string;
  query?: Record<string, string | number | undefined | null>;
  body?: unknown;
  options?: RequestOptions;
}

export async function makeRequest<T>(
  cfg: ResolvedClientConfig,
  req: InternalRequest,
): Promise<T> {
  const url = buildUrl(cfg.baseUrl, req.path, req.query);
  const headers = buildHeaders(cfg, req);

  const userMaxRetries = req.options?.maxRetries ?? cfg.maxRetries;
  const userTimeout = req.options?.timeout ?? cfg.timeout;
  const userSignal = req.options?.signal;

  const bodyJson = req.body !== undefined ? JSON.stringify(req.body) : undefined;

  let attempt = 0;
  let lastError: unknown;

  while (true) {
    const ac = new AbortController();
    const onUserAbort = () => ac.abort();
    if (userSignal) {
      if (userSignal.aborted) ac.abort();
      else userSignal.addEventListener('abort', onUserAbort, { once: true });
    }
    const timer = setTimeout(() => ac.abort(), userTimeout);

    let response: Response | null = null;
    let networkError: unknown = null;

    cfg.logger.debug({ method: req.method, url, attempt }, 'langos request');

    try {
      response = await cfg.fetchImpl(url, {
        method: req.method,
        headers,
        body: bodyJson,
        signal: ac.signal,
      });
    } catch (err) {
      networkError = err;
    } finally {
      clearTimeout(timer);
      if (userSignal) userSignal.removeEventListener('abort', onUserAbort);
    }

    if (networkError) {
      // Distinguish timeout from connection error.
      const isTimeout =
        ac.signal.aborted &&
        !userSignal?.aborted &&
        (networkError as { name?: string })?.name === 'AbortError';
      if (userSignal?.aborted) throw new LangosAbortError(networkError);
      if (attempt < userMaxRetries && shouldRetry(null, true)) {
        const delay = backoffDelay(attempt);
        cfg.logger.debug({ delay, err: String(networkError) }, 'langos retry (network)');
        await sleep(delay);
        attempt++;
        lastError = networkError;
        continue;
      }
      if (isTimeout) throw new LangosTimeoutError(userTimeout);
      throw new LangosConnectionError(
        `Network error: ${(networkError as Error)?.message || String(networkError)}`,
        networkError,
      );
    }

    // We have a response.
    const status = response!.status;
    if (status >= 400) {
      const retryAfterRaw = response!.headers.get('retry-after');
      const retryAfter = retryAfterRaw ? parseInt(retryAfterRaw, 10) : undefined;
      const body = await safeReadJson(response!);

      if (attempt < userMaxRetries && shouldRetry(status, false)) {
        const delay = backoffDelay(
          attempt,
          Number.isFinite(retryAfter) ? (retryAfter as number) : undefined,
          cfg.maxRetryAfterMs,
        );
        cfg.logger.debug({ delay, status }, 'langos retry (status)');
        await sleep(delay);
        attempt++;
        lastError = LangosAPIError.from(status, body, response!.headers);
        continue;
      }

      throw LangosAPIError.from(status, body, response!.headers);
    }

    if (status === 204) return undefined as unknown as T;

    // Defensive: a 2xx response from the wrong server (e.g. SPA fallback at the
    // wrong baseUrl) is HTML with content-type text/html. Catch this loud here
    // rather than silently casting garbage downstream.
    const ctype = response!.headers.get('content-type');
    if (ctype && !/^application\/(json|problem\+json)/i.test(ctype)) {
      const text = await response!.text();
      throw new LangosResponseFormatError(ctype, text);
    }

    const data = await safeReadJson(response!);
    return data as T;
  }
}

function buildUrl(
  baseUrl: string,
  path: string,
  query: InternalRequest['query'],
): string {
  const trimmed = baseUrl.replace(/\/$/, '');
  const url = new URL(`${trimmed}${path.startsWith('/') ? path : `/${path}`}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

function buildHeaders(cfg: ResolvedClientConfig, req: InternalRequest): Headers {
  const headers = new Headers();
  headers.set('Authorization', `Bearer ${cfg.apiKey}`);
  headers.set('Accept', 'application/json');
  if (req.body !== undefined) headers.set('Content-Type', 'application/json');
  headers.set('User-Agent', buildUserAgent(cfg));
  if (cfg.telemetry !== false) {
    // `process.platform` and `process.version` are runtime-controlled (set by
    // Node itself), not partner-controlled, so they don't carry the same
    // CRLF-injection risk as `cfg.appName`. We still funnel them through
    // `JSON.stringify` defensively: stringify never emits a raw `\r` or `\n`
    // (control chars are escaped to `\\u000d` / `\\u000a`), so the result is
    // always safe to set as a header value.
    headers.set(
      'X-Langos-Client-Telemetry',
      JSON.stringify({
        lang: 'node',
        sdkVersion: version,
        runtime: typeof process !== 'undefined' ? `${process.platform}/${process.version}` : 'unknown',
      }),
    );
  }
  if (
    req.options?.idempotencyKey ||
    shouldAddIdempotencyKey(req.method, !!req.options?.idempotencyKey)
  ) {
    headers.set('Idempotency-Key', req.options?.idempotencyKey ?? newIdempotencyKey());
  }
  for (const [k, v] of Object.entries(req.options?.headers ?? {})) {
    headers.set(k, v);
  }
  return headers;
}

function buildUserAgent(cfg: ResolvedClientConfig): string {
  const base = `langos-node/${version}`;
  return cfg.appName ? `${base} ${cfg.appName}` : base;
}

async function safeReadJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
