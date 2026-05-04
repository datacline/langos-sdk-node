import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { Webhooks } from '../../src/resources/webhooks.js';
import { LangosSignatureVerificationError } from '../../src/core/errors.js';

const SECRET = 'whsec_test';

function sign(timestamp: number, body: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

describe('Webhooks.constructEvent', () => {
  const now = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({
    id: 'evt_1',
    object: 'event',
    type: 'candidate.completed',
    created_at: '2026-05-03T00:00:00Z',
    data: { candidate_id: 'cand_1' },
  });

  it('verifies a valid signature', () => {
    const sig = `t=${now},v1=${sign(now, body)}`;
    const evt = Webhooks.constructEvent(body, sig, SECRET);
    expect(evt.id).toBe('evt_1');
    expect(evt.type).toBe('candidate.completed');
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
    const tampered = body.replace('candidate.completed', 'candidate.cancelled');
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
});
