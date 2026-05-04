import { randomUUID } from 'node:crypto';

const UNSAFE = new Set(['POST', 'PATCH', 'DELETE', 'PUT']);

export function shouldAddIdempotencyKey(method: string, hasUserKey: boolean): boolean {
  if (hasUserKey) return false;
  return UNSAFE.has(method.toUpperCase());
}

/** Generate a fresh idempotency key. Caller is responsible for reusing it across retries. */
export function newIdempotencyKey(): string {
  return randomUUID();
}
