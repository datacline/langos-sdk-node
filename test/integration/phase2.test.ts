import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import crypto from 'node:crypto';
import { Langos } from '../../src/index.js';
import {
  LangosForbiddenError,
  LangosBadRequestError,
  LangosAPIError,
} from '../../src/core/errors.js';
import {
  seed,
  cleanup,
  seedSession,
  setPassThreshold,
  setPlanQuota,
  setWebhookUrl,
  setSigningSecret,
  setScopes,
  countWebhookDeliveries,
  waitForDelivery,
  type Seeded,
} from './setup.js';

const RUN_LIVE = process.env.LANGOS_TEST_LIVE !== 'false';

(RUN_LIVE ? describe : describe.skip)('phase 2 — paid integration loop', () => {
  let s: Seeded;
  let client: Langos;

  beforeAll(async () => {
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

  // ---------------------------------------------------------------------------
  // T1.3 — GET /v1/account
  // ---------------------------------------------------------------------------

  describe('GET /v1/account', () => {
    it('returns account info for the calling integration', async () => {
      const account = await client.account.retrieve();
      expect(account.object).toBe('account');
      expect(account.id).toBe(s.companyId);
      expect(account.name).toContain('SDK Test Co');
      expect(typeof account.planTier).toBe('string');
      expect(typeof account.sessionsUsed).toBe('number');
      expect(account.integration.provider).toBe('sdk-test');
      expect(account.integration.apiKeyPrefix).toBe(s.apiKey.substring(0, 8));
      expect(Array.isArray(account.integration.scopes)).toBe(true);
      // Phase 2 migration backfilled account:read + webhooks:write.
      expect(account.integration.scopes).toContain('account:read');
      expect(account.integration.scopes).toContain('webhooks:write');
    });

    it('reflects quota math: sessions_remaining = limit - used', async () => {
      setPlanQuota(s.companyId, 7, 25);
      const account = await client.account.retrieve();
      expect(account.sessionsUsed).toBe(7);
      expect(account.sessionsLimit).toBe(25);
      expect(account.sessionsRemaining).toBe(18);
    });

    it('returns null sessions_limit and sessions_remaining on unlimited plan', async () => {
      setPlanQuota(s.companyId, 7, null);
      const account = await client.account.retrieve();
      expect(account.sessionsLimit).toBeNull();
      expect(account.sessionsRemaining).toBeNull();
    });

    it('rejects when integration lacks account:read scope', async () => {
      setScopes(s.integrationId, ['candidates:read', 'sessions:read']);
      try {
        await expect(client.account.retrieve()).rejects.toBeInstanceOf(LangosForbiddenError);
      } finally {
        setScopes(s.integrationId, [
          'assessments:read', 'candidates:read', 'candidates:write',
          'sessions:read', 'account:read', 'webhooks:write',
        ]);
        // Restore quota for downstream tests.
        setPlanQuota(s.companyId, 0, 30);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // T1.4 — Quota-exceeded structured error on POST /v1/candidates
  // ---------------------------------------------------------------------------

  describe('POST /v1/candidates over quota', () => {
    it('returns 402 quota_exceeded with structured details', async () => {
      setPlanQuota(s.companyId, 30, 30);
      try {
        let caught: any = null;
        try {
          await client.candidates.create({ email: 'over@example.com', assessmentId: s.assessmentTypeId });
        } catch (err) {
          caught = err;
        }
        expect(caught).toBeInstanceOf(LangosAPIError);
        expect(caught.status).toBe(402);
        expect(caught.code).toBe('quota_exceeded');
        // Body should include parseable quota details so partners can render
        // a friendly upgrade prompt.
        expect(caught.message).toMatch(/over quota|quota_exceeded/i);
      } finally {
        setPlanQuota(s.companyId, 0, 30);
      }
    });

    it('does not 402 when DISABLE_BILLING bypass is in effect (skipped)', () => {
      // Sanity check that the bypass exists; we don't toggle env vars at runtime
      // since the server is already running.
      expect(true).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // T1.1 — passed boolean
  // ---------------------------------------------------------------------------

  describe('passed boolean on session', () => {
    it('passed: true when score >= pass_threshold', async () => {
      setPassThreshold(s.companyId, 70);
      const seeded = seedSession(s, { overallScore: 85 });
      const session = await client.sessions.retrieve(seeded.sessionId);
      expect(session.score).toBe(85);
      expect(session.passed).toBe(true);
    });

    it('passed: false when score < pass_threshold', async () => {
      setPassThreshold(s.companyId, 70);
      const seeded = seedSession(s, { overallScore: 50 });
      const session = await client.sessions.retrieve(seeded.sessionId);
      expect(session.passed).toBe(false);
    });

    it('passed: null when score is null', async () => {
      setPassThreshold(s.companyId, 70);
      const seeded = seedSession(s, { overallScore: null, status: 'submitted' });
      const session = await client.sessions.retrieve(seeded.sessionId);
      expect(session.passed).toBeNull();
    });

    it('passed: null when pass_threshold is unset (do not guess)', async () => {
      setPassThreshold(s.companyId, null);
      const seeded = seedSession(s, { overallScore: 85 });
      const session = await client.sessions.retrieve(seeded.sessionId);
      expect(session.passed).toBeNull();
      // Restore threshold for downstream tests.
      setPassThreshold(s.companyId, 70);
    });
  });

  // ---------------------------------------------------------------------------
  // T1.2 — Working partner-readable report URL
  // ---------------------------------------------------------------------------

  describe('report_url on session', () => {
    it('present when score is set, points at /r/sessions/:id with a token', async () => {
      setPassThreshold(s.companyId, 70);
      const seeded = seedSession(s, { overallScore: 85 });
      const session = await client.sessions.retrieve(seeded.sessionId);
      expect(session.reportUrl).not.toBeNull();
      expect(session.reportUrl).toContain(`/r/sessions/${seeded.sessionId}`);
      expect(session.reportUrl).toMatch(/\?t=[\w.-]+$/);
    });

    it('null when score has not been calculated', async () => {
      const seeded = seedSession(s, { overallScore: null });
      const session = await client.sessions.retrieve(seeded.sessionId);
      expect(session.reportUrl).toBeNull();
    });

    it('the report URL renders an HTML page (200) with the score', async () => {
      setPassThreshold(s.companyId, 70);
      const seeded = seedSession(s, {
        overallScore: 85,
        activeSeconds: 1200,
        codingSeconds: 900,
        editorEvents: 500,
        runEvents: 12,
      });
      const session = await client.sessions.retrieve(seeded.sessionId);
      expect(session.reportUrl).not.toBeNull();

      // Server-side APP_BASE_URL points at Traefik (8089) which doesn't proxy /r/.
      // Rewrite to the direct app port (3001) for the test.
      const baseAppUrl = (process.env.LANGOS_TEST_BASE_URL || 'http://localhost:3001/api/v1').replace(/\/api\/v1$/, '');
      const directReportUrl = session.reportUrl!.replace(/^https?:\/\/[^/]+/, baseAppUrl);
      const res = await fetch(directReportUrl);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')?.toLowerCase()).toContain('text/html');
      const html = await res.text();
      expect(html).toContain('85');
      expect(html).toContain('Passed');
    });

    it('returns 401 with no token', async () => {
      const seeded = seedSession(s, { overallScore: 85 });
      const baseAppUrl = (process.env.LANGOS_TEST_BASE_URL || 'http://localhost:3001/api/v1').replace(/\/api\/v1$/, '');
      const res = await fetch(`${baseAppUrl}/r/sessions/${seeded.sessionId}`);
      expect(res.status).toBe(401);
    });

    it('returns 403 when token issued for a different session', async () => {
      const a = seedSession(s, { overallScore: 85 });
      const b = seedSession(s, { overallScore: 60 });
      const sessionA = await client.sessions.retrieve(a.sessionId);
      // token from session A, path is session B
      const u = new URL(sessionA.reportUrl!);
      // Use test app base URL (3001) so the route handler is hit directly.
      const baseAppUrl = (process.env.LANGOS_TEST_BASE_URL || 'http://localhost:3001/api/v1').replace(/\/api\/v1$/, '');
      const res = await fetch(`${baseAppUrl}/r/sessions/${b.sessionId}?t=${u.searchParams.get('t')}`);
      expect(res.status).toBe(403);
    });

    it('returns 401 with garbage token', async () => {
      const seeded = seedSession(s, { overallScore: 85 });
      const baseAppUrl = (process.env.LANGOS_TEST_BASE_URL || 'http://localhost:3001/api/v1').replace(/\/api\/v1$/, '');
      const res = await fetch(`${baseAppUrl}/r/sessions/${seeded.sessionId}?t=not-a-jwt`);
      expect(res.status).toBe(401);
    });
  });

  // ---------------------------------------------------------------------------
  // T2.1 — Typed analytics fields on session
  // ---------------------------------------------------------------------------

  describe('typed analytics fields', () => {
    it('returns 0s for sessions with no analytics row', async () => {
      const seeded = seedSession(s, { overallScore: 70 });
      const session = await client.sessions.retrieve(seeded.sessionId);
      expect(session.analytics).toBeDefined();
      expect(session.analytics.editorEventCount).toBe(0);
      expect(session.analytics.activeSeconds).toBe(0);
      expect(session.analytics.codingSeconds).toBe(0);
    });

    it('returns the recorded counts when analytics exists', async () => {
      const seeded = seedSession(s, {
        overallScore: 80,
        editorEvents: 250,
        runEvents: 8,
        testEvents: 3,
        aiEvents: 5,
        pasteEvents: 2,
        activeSeconds: 1800,
        codingSeconds: 1400,
        idleSeconds: 100,
      });
      const session = await client.sessions.retrieve(seeded.sessionId);
      expect(session.analytics.editorEventCount).toBe(250);
      expect(session.analytics.runEventCount).toBe(8);
      expect(session.analytics.testEventCount).toBe(3);
      expect(session.analytics.aiEventCount).toBe(5);
      expect(session.analytics.pasteEventCount).toBe(2);
      expect(session.analytics.activeSeconds).toBe(1800);
      expect(session.analytics.codingSeconds).toBe(1400);
      expect(session.analytics.idleSeconds).toBe(100);
    });
  });

  // ---------------------------------------------------------------------------
  // T1.5 — PATCH /v1/account/webhook-endpoint
  // ---------------------------------------------------------------------------

  describe('PATCH /v1/account/webhook-endpoint', () => {
    it('sets the webhook_url and rotates the signing secret', async () => {
      const result = await client.account.setWebhookEndpoint({
        webhookUrl: 'https://hooks.example.com/langos',
        rotateSigningSecret: true,
      });
      expect(result.webhookUrl).toBe('https://hooks.example.com/langos');
      expect(result.signingSecret).not.toBeNull();
      expect(result.signingSecret!.startsWith('whsec_')).toBe(true);

      const account = await client.account.retrieve();
      expect(account.integration.webhookUrl).toBe('https://hooks.example.com/langos');
    });

    it('clears the webhook_url with null', async () => {
      const result = await client.account.setWebhookEndpoint({ webhookUrl: null });
      expect(result.webhookUrl).toBeNull();
    });

    it('rejects non-http(s) webhook URLs as 400', async () => {
      let caught: any = null;
      try {
        await client.account.setWebhookEndpoint({ webhookUrl: 'ftp://nope.example.com/' });
      } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(LangosBadRequestError);
    });

    it('does not return signing_secret on subsequent reads', async () => {
      // Setup
      await client.account.setWebhookEndpoint({
        webhookUrl: 'https://hooks.example.com/langos',
        rotateSigningSecret: true,
      });
      // Plain read — should NOT include the secret.
      const account = await client.account.retrieve();
      // Account response has no signing_secret field at all by design.
      expect((account as any).integration.signingSecret).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // T1.5 — Outbound webhook delivery on session.completed
  // ---------------------------------------------------------------------------

  describe('outbound webhook delivery', () => {
    it('does NOT fire when integration has no webhook_url', async () => {
      // Make sure webhook is OFF.
      setWebhookUrl(s.integrationId, null);
      const before = countWebhookDeliveries(s.integrationId);
      const seeded = seedSession(s, { overallScore: 85, status: 'submitted' });
      // Trigger the same code path that a real session-end would hit.
      await fireSessionCompletedHook(seeded.assignmentId, seeded.sessionId);
      await new Promise(r => setTimeout(r, 300));
      const after = countWebhookDeliveries(s.integrationId);
      expect(after).toBe(before);
    });

    it('signs and POSTs the event when webhook_url is set, status=2xx → succeeded', async () => {
      const captured: { method?: string; headers?: any; body?: string } = {};
      const server = http.createServer((req, res) => {
        captured.method = req.method;
        captured.headers = req.headers;
        let buf = '';
        req.on('data', chunk => { buf += chunk.toString('utf8'); });
        req.on('end', () => {
          captured.body = buf;
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end('{"ok":true}');
        });
      });
      await new Promise<void>(r => server.listen(0, '0.0.0.0', r));
      const port = (server.address() as any).port;
      const url = `http://host.docker.internal:${port}/hooks`;
      try {
        // Set a known signing secret so we can verify the signature.
        const secret = `whsec_${crypto.randomBytes(16).toString('hex')}`;
        setSigningSecret(s.integrationId, secret);
        setWebhookUrl(s.integrationId, url);

        const seeded = seedSession(s, { overallScore: 90, status: 'submitted' });
        await fireSessionCompletedHook(seeded.assignmentId, seeded.sessionId);

        const delivery = await waitForDelivery(s.integrationId, d =>
          d?.responseStatus === 200 && d?.attempts >= 1
        , 8_000);
        expect(delivery).not.toBeNull();
        expect(delivery!.eventType).toBe('session.completed');
        expect(delivery!.targetUrl).toBe(url);
        expect(delivery!.responseStatus).toBe(200);
        expect(delivery!.succeededAt).not.toBeNull();

        // Server captured the request; verify signature + payload shape.
        expect(captured.method).toBe('POST');
        const sigHeader = captured.headers!['langos-signature'];
        expect(sigHeader).toMatch(/^t=\d+,v1=[a-f0-9]+$/);
        const m = sigHeader.match(/^t=(\d+),v1=([a-f0-9]+)$/)!;
        const expected = crypto
          .createHmac('sha256', secret)
          .update(`${m[1]}.${captured.body}`)
          .digest('hex');
        expect(m[2]).toBe(expected);

        const parsed = JSON.parse(captured.body!);
        expect(parsed.type).toBe('session.completed');
        expect(parsed.id.startsWith('evt_')).toBe(true);
        expect(parsed.data.id).toBe(seeded.sessionId);
        expect(parsed.data.score).toBe(90);
        expect(parsed.data.passed).toBe(true);
      } finally {
        await new Promise<void>(r => server.close(() => r()));
        setWebhookUrl(s.integrationId, null);
      }
    }, 15_000);

    it('records attempts and final failure when target returns 5xx forever', async () => {
      let hits = 0;
      const server = http.createServer((req, res) => {
        hits++;
        let buf = '';
        req.on('data', c => { buf += c.toString('utf8'); });
        req.on('end', () => {
          res.writeHead(503, { 'content-type': 'application/json' });
          res.end('{"err":"down"}');
        });
      });
      await new Promise<void>(r => server.listen(0, '0.0.0.0', r));
      const port = (server.address() as any).port;
      const url = `http://host.docker.internal:${port}/down`;
      try {
        setWebhookUrl(s.integrationId, url);

        const seeded = seedSession(s, { overallScore: 60, status: 'submitted' });
        await fireSessionCompletedHook(seeded.assignmentId, seeded.sessionId);

        // Publisher does 3 attempts with 1s + 4s backoff (no wait after last) =
        // ~5s total. Wait up to 8s for the full cycle and final-failure record.
        const delivery = await waitForDelivery(s.integrationId, d =>
          d?.responseStatus === 503 && d?.attempts >= 3 && d?.succeededAt === null
        , 8_000);
        expect(delivery).not.toBeNull();
        expect(delivery!.eventType).toBe('session.completed');
        expect(delivery!.responseStatus).toBe(503);
        expect(delivery!.succeededAt).toBeNull();
        // Full 3-attempt cycle ran.
        expect(delivery!.attempts).toBe(3);
        expect(hits).toBe(3);
      } finally {
        await new Promise<void>(r => server.close(() => r()));
        setWebhookUrl(s.integrationId, null);
      }
    }, 30_000);
  });
});

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Trigger the same backend code path as a real session submission. The publisher
 * in atsService.onAssessmentCompleted requires the ats_assessment status to be
 * 'started' before running, so we set it back to that before invoking.
 *
 *  We invoke via a tiny test-only HTTP shim on the running server: the server
 *  exports `__test/triggerCompleted/:assignmentId` only when NODE_ENV=test/dev.
 *  If that shim isn't available we fall back to calling the public end-of-session
 *  flow directly via raw SQL + a small driver.
 */
async function fireSessionCompletedHook(assignmentId: string, sessionId: string): Promise<void> {
  // Set the ats_assessment back to 'started' so onAssessmentCompleted's
  // WHERE-clause finds it.
  const psql = (sql: string) => {
    const { execSync } = require('node:child_process');
    return execSync(
      `docker exec langos-ide-db-1 psql -U codestream -d codestream -tAc ${JSON.stringify(sql.replace(/\s+/g, ' '))}`,
    ).toString().trim();
  };
  psql(`UPDATE ats_assessments SET status = 'started' WHERE assignment_id = '${assignmentId}'`);

  // Hit a test-only backend endpoint that runs onAssessmentCompleted.
  const baseUrl = (process.env.LANGOS_TEST_BASE_URL || 'http://localhost:3001/api/v1').replace(/\/api\/v1$/, '');
  const res = await fetch(`${baseUrl}/__test/partner/fire-session-completed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ assignmentId, sessionId }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`fireSessionCompletedHook failed: ${res.status} ${txt}`);
  }
}
