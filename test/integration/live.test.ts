import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Langos } from '../../src/index.js';
import {
  LangosAuthenticationError,
  LangosForbiddenError,
  LangosNotFoundError,
  LangosRateLimitError,
} from '../../src/core/errors.js';
import { seed, cleanup, setRateLimit, setScopes, setEnabled, type Seeded } from './setup.js';

const RUN_LIVE = process.env.LANGOS_TEST_LIVE !== 'false';

(RUN_LIVE ? describe : describe.skip)('@datacline/langos-sdk-node integration (live server)', () => {
  let s: Seeded;
  let client: Langos;

  beforeAll(async () => {
    // Health check first; bail loudly if the server isn't up.
    const r = await fetch(`${process.env.LANGOS_TEST_BASE_URL?.replace(/\/api\/v1$/, '') || 'http://localhost:3001'}/api/health`).catch(() => null);
    if (!r || !r.ok) {
      throw new Error('Local stack is not reachable on http://localhost:3001 — bring up `docker compose up -d` before running integration tests.');
    }
    s = await seed();
    client = new Langos({ apiKey: s.apiKey, baseUrl: s.baseUrl, telemetry: false });
  }, 30_000);

  afterAll(async () => {
    if (s) await cleanup(s);
  });

  it('GET /openapi.json is publicly reachable', async () => {
    const url = s.baseUrl.replace(/\/v1$/, '/v1/openapi.json');
    const res = await fetch(url);
    expect(res.status).toBe(200);
    const spec = await res.json();
    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.info?.title).toBe('Langos Partner API');
  });

  it('rejects unauthenticated requests with 401', async () => {
    const noAuth = new Langos({ apiKey: 'bad_key_xxxxxxxxxxxxxxxxxxxxxx', baseUrl: s.baseUrl, telemetry: false, maxRetries: 0 });
    await expect(noAuth.assessments.list()).rejects.toBeInstanceOf(LangosAuthenticationError);
  });

  it('rejects requests when integration is disabled (403)', async () => {
    setEnabled(s.integrationId, false);
    try {
      await expect(client.assessments.list()).rejects.toBeInstanceOf(LangosForbiddenError);
    } finally {
      setEnabled(s.integrationId, true);
    }
  });

  it('rejects requests missing required scope (403)', async () => {
    setScopes(s.integrationId, ['candidates:read']);
    try {
      await expect(client.assessments.list()).rejects.toBeInstanceOf(LangosForbiddenError);
    } finally {
      setScopes(s.integrationId, ['assessments:read', 'candidates:read', 'candidates:write', 'sessions:read']);
    }
  });

  it('lists assessments for the seeded tenant', async () => {
    const page = await client.assessments.list();
    expect(page.data.length).toBeGreaterThanOrEqual(1);
    const seeded = page.data.find(a => a.id === s.assessmentTypeId);
    expect(seeded).toBeDefined();
    expect(seeded!.name).toBe('Test Assessment');
    expect(seeded!.challengeCount).toBe(1);
  });

  it('retrieves a single assessment', async () => {
    const a = await client.assessments.retrieve(s.assessmentTypeId);
    expect(a.id).toBe(s.assessmentTypeId);
    expect(a.object).toBe('assessment');
  });

  it('returns 404 for unknown assessment', async () => {
    await expect(
      client.assessments.retrieve('00000000-0000-0000-0000-000000000000'),
    ).rejects.toBeInstanceOf(LangosNotFoundError);
  });

  it('lists candidates (initially empty for fresh tenant)', async () => {
    const page = await client.candidates.list();
    expect(page.object).toBeUndefined();
    expect(Array.isArray(page.data)).toBe(true);
  });

  it('enforces per-integration rate limit', async () => {
    // Use a fresh integration so the in-memory bucket is empty. Sharing
    // s.integrationId would inherit hits from earlier tests and trigger 429
    // on the very first call.
    const fresh = await seed();
    try {
      setRateLimit(fresh.integrationId, 2);
      const tight = new Langos({ apiKey: fresh.apiKey, baseUrl: fresh.baseUrl, telemetry: false, maxRetries: 0 });
      await tight.assessments.list();
      await tight.assessments.list();
      await expect(tight.assessments.list()).rejects.toBeInstanceOf(LangosRateLimitError);
    } finally {
      await cleanup(fresh);
    }
  });

  it('returns rate-limit headers on every successful call', async () => {
    const fresh = await seed();
    try {
      setRateLimit(fresh.integrationId, 5);
      const url = `${fresh.baseUrl}/assessments`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${fresh.apiKey}` } });
      expect(res.status).toBe(200);
      expect(res.headers.get('x-ratelimit-limit')).toBe('5');
      expect(parseInt(res.headers.get('x-ratelimit-remaining')!, 10)).toBeLessThanOrEqual(4);
      expect(res.headers.get('x-ratelimit-reset')).toBeTruthy();
    } finally {
      await cleanup(fresh);
    }
  });

  it('records a row in api_audit_log per request', async () => {
    const before = parseInt(
      execAndRead(`SELECT COUNT(*) FROM api_audit_log WHERE integration_id = '${s.integrationId}'`),
      10,
    );
    await client.assessments.list();
    // Audit insert is non-blocking; give it a moment.
    await new Promise(r => setTimeout(r, 200));
    const after = parseInt(
      execAndRead(`SELECT COUNT(*) FROM api_audit_log WHERE integration_id = '${s.integrationId}'`),
      10,
    );
    expect(after).toBeGreaterThan(before);
  });
});

function execAndRead(sql: string): string {
  const { execSync } = require('node:child_process');
  return execSync(
    `docker exec langos-ide-db-1 psql -U codestream -d codestream -tAc ${JSON.stringify(sql)}`,
  ).toString().trim();
}
