import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { Langos } from '../../src/index.js';

const BASE = 'https://pag.test.local/v1';

const PAGE_1 = {
  object: 'list' as const,
  data: [
    { id: '1', object: 'assessment', name: 'A', description: null, challenge_count: 1, created_at: 't', updated_at: 't' },
    { id: '2', object: 'assessment', name: 'B', description: null, challenge_count: 1, created_at: 't', updated_at: 't' },
  ],
  has_more: true,
  next_cursor: 'c1',
};
const PAGE_2 = {
  object: 'list' as const,
  data: [
    { id: '3', object: 'assessment', name: 'C', description: null, challenge_count: 1, created_at: 't', updated_at: 't' },
  ],
  has_more: false,
  next_cursor: null,
};

const server = setupServer(
  http.get(`${BASE}/assessments`, ({ request }) => {
    const cursor = new URL(request.url).searchParams.get('cursor');
    return HttpResponse.json(cursor === 'c1' ? PAGE_2 : PAGE_1);
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('pagination', () => {
  it('returns first page eagerly with hasMore + nextCursor', async () => {
    const client = new Langos({ apiKey: 'k', baseUrl: BASE, telemetry: false });
    const page = await client.assessments.list();
    expect(page.data.map(a => a.id)).toEqual(['1', '2']);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe('c1');
  });

  it('getNextPage fetches the next page', async () => {
    const client = new Langos({ apiKey: 'k', baseUrl: BASE, telemetry: false });
    const page = await client.assessments.list();
    const next = await page.getNextPage();
    expect(next?.data.map(a => a.id)).toEqual(['3']);
    expect(next?.hasMore).toBe(false);
    expect(await next?.getNextPage()).toBeNull();
  });

  it('async-iterates across pages', async () => {
    const client = new Langos({ apiKey: 'k', baseUrl: BASE, telemetry: false });
    const ids: string[] = [];
    for await (const a of await client.assessments.list()) {
      ids.push(a.id);
    }
    expect(ids).toEqual(['1', '2', '3']);
  });
});
