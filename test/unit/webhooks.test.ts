import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { Webhooks } from '../../src/resources/webhooks.js';
import { LangosSignatureVerificationError } from '../../src/core/errors.js';

// Real signing secrets are at least 32 random bytes server-side. Use a
// 16+ char fixture to satisfy the SDK's minimum-length check while staying
// recognizably synthetic.
const SECRET = 'whsec_test_secret_value_0123456789';

function sign(timestamp: number, body: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

describe('Webhooks.constructEvent', () => {
  const now = Math.floor(Date.now() / 1000);
  // Fixture mirrors the server-side publisher payload (see monorepo
  // services/customer/webhookPublisher.js — canonical event list is
  // session.submitted | session.completed | candidate.cancelled).
  const body = JSON.stringify({
    id: 'evt_1',
    object: 'event',
    type: 'candidate.cancelled',
    created: '2026-05-03T00:00:00Z',
    data: { candidate_id: 'cand_1' },
  });

  it('verifies a valid signature and exposes the canonical "created" field', () => {
    const sig = `t=${now},v1=${sign(now, body)}`;
    const evt = Webhooks.constructEvent(body, sig, SECRET);
    expect(evt.id).toBe('evt_1');
    expect(evt.type).toBe('candidate.cancelled');
    expect(evt.created).toBe('2026-05-03T00:00:00Z');
  });

  it('rejects mismatched signature', () => {
    const sig = `t=${now},v1=${'00'.repeat(32)}`;
    expect(() => Webhooks.constructEvent(body, sig, SECRET)).toThrow(
      LangosSignatureVerificationError,
    );
  });

  it('rejects timestamp outside tolerance', () => {
    const old = now - 1000;
    const sig = `t=${old},v1=${sign(old, body)}`;
    expect(() => Webhooks.constructEvent(body, sig, SECRET)).toThrow(
      LangosSignatureVerificationError,
    );
  });

  it('rejects missing header', () => {
    expect(() => Webhooks.constructEvent(body, undefined, SECRET)).toThrow(
      LangosSignatureVerificationError,
    );
  });

  it('rejects malformed header', () => {
    expect(() => Webhooks.constructEvent(body, 'not-a-real-header', SECRET)).toThrow(
      LangosSignatureVerificationError,
    );
  });

  it('accepts when one of multiple signatures matches (rotation)', () => {
    const sig = `t=${now},v1=${'aa'.repeat(32)},v1=${sign(now, body)}`;
    const evt = Webhooks.constructEvent(body, sig, SECRET);
    expect(evt.id).toBe('evt_1');
  });

  it('rejects body that has been tampered after signing', () => {
    const sig = `t=${now},v1=${sign(now, body)}`;
    const tampered = body.replace('candidate.cancelled', 'session.completed');
    expect(() => Webhooks.constructEvent(tampered, sig, SECRET)).toThrow(
      LangosSignatureVerificationError,
    );
  });

  it('rejects non-JSON payload after sig passes', () => {
    const garbage = 'not-json';
    const sig = `t=${now},v1=${sign(now, garbage)}`;
    expect(() => Webhooks.constructEvent(garbage, sig, SECRET)).toThrow(
      LangosSignatureVerificationError,
    );
  });

  // Blocker 4: empty / too-short signing secret. If a partner forgot to set
  // LANGOS_WEBHOOK_SECRET we must NOT fall through to HMAC'ing with the empty
  // string — an attacker who knows this could forge events that pass
  // verification. We sign WITH the empty secret here so that without the
  // pre-input guard, the signature would actually verify; the test then
  // proves the guard short-circuits before reaching HMAC computation.
  it('rejects empty signing secret even when sig was forged with empty secret', () => {
    const forgedSig = `t=${now},v1=${sign(now, body, '')}`;
    expect(() => Webhooks.constructEvent(body, forgedSig, '')).toThrow(
      LangosSignatureVerificationError,
    );
  });

  it('rejects too-short signing secret (< 16 chars) even when sig was forged with same short secret', () => {
    const forgedSig = `t=${now},v1=${sign(now, body, 'short')}`;
    expect(() => Webhooks.constructEvent(body, forgedSig, 'short')).toThrow(
      LangosSignatureVerificationError,
    );
  });

  it('rejects non-string signing secret', () => {
    const sig = `t=${now},v1=${sign(now, body)}`;
    // Forced-cast: simulate JS callers passing a non-string by mistake (e.g.
    // a misconfigured env var resolved to undefined).
    expect(() =>
      Webhooks.constructEvent(body, sig, undefined as unknown as string),
    ).toThrow(LangosSignatureVerificationError);
  });

  // Blocker 5: malformed timestamp values must be rejected as a *malformed
  // signature header* rather than silently parsed and only failing later via
  // the tolerance check. Asserting on the error message distinguishes the
  // pre-fix (tolerance) and post-fix (malformed) code paths.
  describe('malformed timestamp in signature header', () => {
    it('rejects t=0 (non-positive) as malformed, not tolerance', () => {
      const sig = `t=0,v1=${sign(0, body)}`;
      expect(() => Webhooks.constructEvent(body, sig, SECRET)).toThrow(
        /Malformed signature header/,
      );
    });

    it('rejects t=-1 (negative) as malformed, not tolerance', () => {
      const sig = `t=-1,v1=${sign(-1, body)}`;
      expect(() => Webhooks.constructEvent(body, sig, SECRET)).toThrow(
        /Malformed signature header/,
      );
    });

    it('rejects t=999999999999 (past unix-epoch overflow) as malformed, not tolerance', () => {
      const absurd = 999_999_999_999;
      const sig = `t=${absurd},v1=${sign(absurd, body)}`;
      expect(() => Webhooks.constructEvent(body, sig, SECRET)).toThrow(
        /Malformed signature header/,
      );
    });

    it('rejects t=abc (non-numeric) as malformed', () => {
      const sig = `t=abc,v1=${sign(now, body)}`;
      expect(() => Webhooks.constructEvent(body, sig, SECRET)).toThrow(
        /Malformed signature header/,
      );
    });
  });
});
