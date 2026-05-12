import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  LangosSignatureVerificationError,
  LangosWebhookPayloadError,
} from '../core/errors.js';
import type { WebhookEvent } from '../types.js';

const DEFAULT_TOLERANCE_SECONDS = 300;
// Minimum acceptable signing-secret length. The server mints `whsec_…` secrets
// with at least 32 random bytes, so anything shorter is either a misconfigured
// integration or an attacker probing for a missing-secret default. Rejecting
// short secrets explicitly avoids the "partner forgot to set
// LANGOS_WEBHOOK_SECRET, attacker forges events HMAC'd with empty string"
// failure mode.
const MIN_SECRET_LENGTH = 16;
// Reject absurd-future timestamps (year 2106-ish, the unix-epoch overflow
// boundary). A negative or zero `t=` in the signature header is also a tampered
// header — real servers always emit a positive epoch second.
const MAX_TIMESTAMP_SECONDS = 2 ** 32;
// Hard cap on the signature header length we'll parse. A real `Langos-Signature`
// is roughly `t=<10 digits>,v1=<64 hex>` — well under 200 chars even with a
// few rotated keys. Refuse to parse anything beyond 4 KiB so an attacker
// can't waste CPU on `,`-splitting an attacker-controlled megabyte string
// before we even reach HMAC.
const MAX_SIGNATURE_HEADER_LENGTH = 4096;

/**
 * Webhook helpers. v1.0 ships verification only — outbound delivery from Langos
 * is on the roadmap. Partners can wire `constructEvent` against the planned
 * signature header today; the SDK contract will not change when delivery lands.
 *
 * Pattern matches Stripe's `stripe.webhooks.constructEvent` so partners with
 * existing handlers re-use the same shape.
 */
export const Webhooks = {
  constructEvent<T = unknown>(
    payload: string | Buffer,
    signatureHeader: string | string[] | undefined | null,
    secret: string,
    tolerance: number = DEFAULT_TOLERANCE_SECONDS,
  ): WebhookEvent<T> {
    // Validate the signing secret BEFORE inspecting any partner-controlled
    // input. If the partner forgot to set LANGOS_WEBHOOK_SECRET we must NOT
    // fall through to HMAC'ing with the empty string — an attacker who knows
    // this could forge events that pass verification.
    if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) {
      throw new LangosSignatureVerificationError(
        `Signing secret missing or too short (need at least ${MIN_SECRET_LENGTH} chars). ` +
          'Set the secret returned by `client.account.rotateSigningSecret()`.',
      );
    }
    if (!signatureHeader) {
      throw new LangosSignatureVerificationError('Missing Langos-Signature header');
    }
    // Some proxies / Node frameworks expose duplicate `Langos-Signature`
    // headers as a string[] (e.g. raw `IncomingMessage.headers` for
    // set-cookie-style multi-value semantics). Joining with `,` is safe
    // because `parseSignatureHeader` already splits on `,` — every `t=` and
    // `v1=` entry from every copy of the header gets considered, and the
    // mismatch tolerance is just "no signature matched". Picking
    // `signatureHeader[0]` (the previous behavior) silently dropped the
    // signatures emitted by other copies of the header, which broke key
    // rotation when a proxy split versus joined the values inconsistently.
    let sigHeader: string;
    if (Array.isArray(signatureHeader)) {
      if (signatureHeader.length === 0) {
        throw new LangosSignatureVerificationError('Missing Langos-Signature header');
      }
      sigHeader = signatureHeader.join(',');
    } else {
      sigHeader = signatureHeader;
    }

    if (sigHeader.length > MAX_SIGNATURE_HEADER_LENGTH) {
      throw new LangosSignatureVerificationError(
        `Signature header exceeds ${MAX_SIGNATURE_HEADER_LENGTH} chars (refusing to parse attacker-controlled oversize input)`,
      );
    }

    const parsed = parseSignatureHeader(sigHeader);
    if (parsed.timestamp === null || parsed.signatures.length === 0) {
      throw new LangosSignatureVerificationError(
        'Malformed signature header (expected t=...,v1=...)',
      );
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - parsed.timestamp) > tolerance) {
      throw new LangosSignatureVerificationError(
        `Timestamp outside the tolerance window (${tolerance}s)`,
      );
    }

    const rawBody = typeof payload === 'string' ? payload : payload.toString('utf-8');
    const expected = computeSignature(secret, parsed.timestamp, rawBody);
    const ok = parsed.signatures.some(s => safeEquals(s, expected));
    if (!ok) {
      throw new LangosSignatureVerificationError('No signatures matched');
    }

    // Signature has verified at this point. A JSON-parse failure here is a
    // *payload* problem, not a signature problem — different operational
    // response (file an upstream/producer ticket; do NOT rotate the secret).
    // Throw a distinct error so partner handlers can branch on the
    // remediation, not just log "verification failed" for both.
    let event: WebhookEvent<T>;
    try {
      event = JSON.parse(rawBody) as WebhookEvent<T>;
    } catch (err) {
      throw new LangosWebhookPayloadError(
        `signature OK but body is not valid JSON: ${(err as Error).message}`,
      );
    }

    return event;
  },
};

function parseSignatureHeader(header: string): { timestamp: number | null; signatures: string[] } {
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const [k, v] = part.trim().split('=');
    if (k === 't' && v) {
      const n = parseInt(v, 10);
      // Only accept a finite, positive, sane epoch second. Rejects:
      //   - `t=abc`          → NaN
      //   - `t=0`, `t=-1`    → non-positive (real servers never emit this)
      //   - `t=999999999999` → past the year-2106 unix overflow boundary,
      //                        either tampered or absurd clock drift
      // The downstream tolerance check would also catch `t=0`, but failing
      // fast here keeps the malformed-header error message clear.
      if (Number.isFinite(n) && n > 0 && n < MAX_TIMESTAMP_SECONDS) {
        timestamp = n;
      }
    }
    if (k === 'v1' && v) signatures.push(v);
  }
  return { timestamp, signatures };
}

function computeSignature(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

function safeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ab.length !== bb.length || ab.length === 0) return false;
  try {
    return timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}
