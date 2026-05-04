import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { Langos } from '../../src/index.js';
import { LangosAuthenticationError, LangosNotFoundError } from '../../src/core/errors.js';

const BASE = 'https://api.test.local/v1';

let receivedAuth: string | undefined;
let receivedUA: string | undefined;
let receivedIdempotency: string | undefined;
let postBody: any;
let attemptCount = 0;

const server = setupServer(
  http.get(`${BASE}/assessments`, ({ request }) => {
    receivedAuth = request.headers.get('authorization') ?? undefined;
    receivedUA = request.headers.get('user-agent') ?? undefined;
    return HttpResponse.json({
      object: 'list',
      data: [
        { id: '1', object: 'assessment', name: 'A', description: null, challenge_count: 1, created_at: 't', updated_at: 't' },
        { id: '2', object: 'assessment', name: 'B', description: null, challenge_count: 2, created_at: 't', updated_at: 't' },
      ],
      has_more: false,
      next_cursor: null,
    });
  }),
  http.get(`${BASE}/assessments/missing`, () =>
    HttpResponse.json({ code: 'assessment_not_found' }, { status: 404 }),
  ),
  http.get(`${BASE}/assessments/no-auth`, () =>
    HttpResponse.json({ code: 'unauthorized' }, { status: 401 }),
  ),
  http.post(`${BASE}/candidates`, async ({ request }) => {
    receivedIdempotency = request.headers.get('idempotency-key') ?? undefined;
    postBody = await request.json();
    return HttpResponse.json({
      id: 'cand_1',
      object: 'candidate',
      email: (postBody as any).email,
      assessment_id: (postBody as any).assessment_id,
      status: 'invited',
      invitation_url: 'https://x/invite/abc',
      invited_at: 't',
      created_at: 't',
      updated_at: 't',
    }, { status: 201 });
  }),
  http.get(`${BASE}/flaky`, () => {
    attemptCount++;
    if (attemptCount < 3) {
      return new HttpResponse('upstream', { status: 503 });
    }
    return HttpResponse.json({ ok: true });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  receivedAuth = undefined;
  receivedUA = undefined;
  receivedIdempotency = undefined;
  postBody = undefined;
  attemptCount = 0;
});
afterAll(() => server.close());

describe('Langos client', () => {
  it('sends Bearer auth and User-Agent', async () => {
    const client = new Langos({ apiKey: 'sk_test', baseUrl: BASE, telemetry: false });
    const page = await client.assessments.list();
    expect(page.data).toHaveLength(2);
    expect(receivedAuth).toBe('Bearer sk_test');
    expect(receivedUA).toMatch(/^langos-node\//);
  });

  it('appends appName to UA', async () => {
    const client = new Langos({
      apiKey: 'sk_test',
      baseUrl: BASE,
      appName: 'GreenhouseConnector/2.1.0',
      telemetry: false,
    });
    await client.assessments.list();
    expect(receivedUA).toContain('GreenhouseConnector/2.1.0');
  });

  it('throws LangosAuthenticationError on 401', async () => {
    const client = new Langos({ apiKey: 'sk_test', baseUrl: BASE, telemetry: false, maxRetries: 0 });
    await expect(client.assessments.retrieve('no-auth')).rejects.toBeInstanceOf(
      LangosAuthenticationError,
    );
  });

  it('throws LangosNotFoundError on 404', async () => {
    const client = new Langos({ apiKey: 'sk_test', baseUrl: BASE, telemetry: false, maxRetries: 0 });
    await expect(client.assessments.retrieve('missing')).rejects.toBeInstanceOf(
      LangosNotFoundError,
    );
  });

  it('auto-generates Idempotency-Key on POST', async () => {
    const client = new Langos({ apiKey: 'sk_test', baseUrl: BASE, telemetry: false });
    await client.candidates.create({ email: 'a@b.com', assessmentId: 'asm_1' });
    expect(receivedIdempotency).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('respects user-supplied Idempotency-Key', async () => {
    const client = new Langos({ apiKey: 'sk_test', baseUrl: BASE, telemetry: false });
    await client.candidates.create(
      { email: 'a@b.com', assessmentId: 'asm_1' },
      { idempotencyKey: 'user-key-123' },
    );
    expect(receivedIdempotency).toBe('user-key-123');
  });

  it('serializes camelCase params to snake_case wire format', async () => {
    const client = new Langos({ apiKey: 'sk_test', baseUrl: BASE, telemetry: false });
    await client.candidates.create({
      email: 'a@b.com',
      assessmentId: 'asm_1',
      externalId: 'ghx-9',
    });
    expect(postBody).toMatchObject({ assessment_id: 'asm_1', external_id: 'ghx-9' });
  });

  it('retries 503 and returns success on 3rd attempt', async () => {
    const client = new Langos({ apiKey: 'sk_test', baseUrl: BASE, telemetry: false, maxRetries: 3 });
    // Use makeRequest indirectly via a custom path — exercise the retry path through assessments.retrieve
    // pointing at /flaky won't typecheck, so we test via direct fetch through resources.assessments.list
    // by stubbing the list endpoint to be flaky:
    server.use(
      http.get(`${BASE}/assessments`, () => {
        attemptCount++;
        if (attemptCount < 3) return new HttpResponse('upstream', { status: 503 });
        return HttpResponse.json({ object: 'list', data: [], has_more: false, next_cursor: null });
      }),
    );
    const page = await client.assessments.list();
    expect(page.data).toEqual([]);
    expect(attemptCount).toBe(3);
  });
});
