import { createHmac, timingSafeEqual } from 'node:crypto';
import { LangosSignatureVerificationError } from '../core/errors.js';
import type { WebhookEvent } from '../types.js';

const DEFAULT_TOLERANCE_SECONDS = 300;

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
    if (!signatureHeader) {
      throw new LangosSignatureVerificationError('Missing Langos-Signature header');
    }
    const sigHeader = Array.isArray(signatureHeader) ? signatureHeader[0]! : signatureHeader;

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

    let event: WebhookEvent<T>;
    try {
      event = JSON.parse(rawBody) as WebhookEvent<T>;
    } catch {
      throw new LangosSignatureVerificationError('Payload is not valid JSON');
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
      if (Number.isFinite(n)) timestamp = n;
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
