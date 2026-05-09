# `@datacline/langos-sdk-node`

Official Node.js / TypeScript SDK for the Langos Partner API.

Use this SDK to wire Langos coding assessments into any hiring workflow. Wraps the public Partner API at `app.langos.io/api/v1`.

> **Status:** alpha. Surface is small (assessments, candidates, sessions, webhook signature verification) and may change before `1.0.0`.

## Install

```bash
npm install @datacline/langos-sdk-node
# or
pnpm add @datacline/langos-sdk-node
# or
yarn add @datacline/langos-sdk-node
```

Requires **Node 18.17+** (Node 20 LTS recommended). Works in Bun, Deno (via npm:), Cloudflare Workers, and Vercel Edge as long as `fetch` and `crypto` are available.

## Quickstart

```ts
import { Langos } from '@datacline/langos-sdk-node';

const client = new Langos({ apiKey: process.env.LANGOS_API_KEY! });

// 1. Find an assessment to invite a candidate to.
for await (const a of await client.assessments.list()) {
  console.log(a.id, a.name);
}

// 2. Invite a candidate.
const candidate = await client.candidates.create({
  email: 'jane@example.com',
  name: 'Jane Doe',
  assessmentId: 'asm_abc',
  externalId: 'your-app-12345',
});
console.log('Invitation URL:', candidate.invitationUrl);

// 3. Poll for results (or use webhooks once outbound delivery ships).
const fresh = await client.candidates.retrieve(candidate.id);
if (fresh.status === 'completed' && fresh.latestSessionId) {
  const session = await client.sessions.retrieve(fresh.latestSessionId);
  console.log('Score:', session.score);
}
```

## Authentication

Set `Authorization: Bearer <api_key>`. The SDK does this for you — just pass `apiKey` to the constructor. API keys are issued by the Langos workspace owner via the recruiter dashboard.

## Other integration paths

Langos integrates with ATS platforms directly (Ashby today; more coming). If your team uses Ashby, you can connect Langos via the Ashby App Marketplace instead of this SDK — both paths surface the same `/v1/account` data, but Ashby manages auth on your behalf. Use this SDK when you want a direct API integration; use the Ashby flow when you'd rather operate Langos inside Ashby's UI.

The `account.integration.provider` field tells you which path your key is using:
- `'customer'` — you minted this key from the Langos dashboard (this SDK)
- `'ashby'` (or another ATS slug) — Langos was wired through your ATS partner

## Resources

| Resource | Methods |
|---|---|
| `client.account` | `retrieve`, `setWebhookEndpoint` |
| `client.assessments` | `list`, `retrieve` |
| `client.challenges` | `list`, `retrieve` |
| `client.candidates` | `list`, `retrieve`, `create`, `cancel` |
| `client.sessions` | `retrieve`, `listForCandidate` |
| `Langos.webhooks` | `constructEvent` (signature verification) |

## Pagination

List methods return an `AsyncIterablePage`. Either iterate across pages automatically:

```ts
for await (const c of await client.candidates.list({ status: 'completed' })) {
  console.log(c.email);
}
```

Or page manually:

```ts
const page = await client.candidates.list({ limit: 50 });
console.log(page.data, page.hasMore, page.nextCursor);
const next = await page.getNextPage(); // null when hasMore is false
```

## Error handling

All API errors throw a typed subclass of `LangosError`:

```ts
import {
  LangosAPIError,
  LangosAuthenticationError,
  LangosForbiddenError,
  LangosNotFoundError,
  LangosBadRequestError,
  LangosConflictError,
  LangosRateLimitError,
  LangosServerError,
  LangosConnectionError,
  LangosTimeoutError,
  LangosSignatureVerificationError,
} from '@datacline/langos-sdk-node';

try {
  await client.candidates.create({ email: 'x@y.com', assessmentId: 'asm_abc' });
} catch (err) {
  if (err instanceof LangosRateLimitError) {
    await sleep((err.retryAfter ?? 1) * 1000);
    // retry
  } else if (err instanceof LangosBadRequestError) {
    console.warn('field errors:', err.errors); // [{ field, message, code }]
  } else if (err instanceof LangosAPIError) {
    console.error(err.status, err.code, err.requestId);
    // Include err.requestId when reporting bugs to Langos support.
  } else throw err;
}
```

## Retries & idempotency

The SDK retries on connection errors and `408`/`409`/`429`/`5xx` (except `501`) up to `maxRetries: 2` by default, with exponential backoff and jitter, honoring `Retry-After`.

For unsafe methods (`POST`, `PATCH`, `DELETE`, `PUT`), an `Idempotency-Key` header is auto-generated and reused across retries — duplicate side effects are eliminated. Override with your own:

```ts
await client.candidates.create(
  { email: 'x@y.com', assessmentId: 'asm_abc' },
  { idempotencyKey: 'your-app-12345-v1' },
);
```

## Webhook signature verification

Verify incoming Langos webhooks with the static helper:

```ts
import express from 'express';
import { Langos } from '@datacline/langos-sdk-node';

const app = express();

app.post(
  '/webhooks/langos',
  express.raw({ type: 'application/json' }),  // CRITICAL: raw body required
  (req, res) => {
    try {
      const event = Langos.webhooks.constructEvent(
        req.body,
        req.headers['langos-signature'],
        process.env.LANGOS_WEBHOOK_SECRET!,
      );
      console.log(event.type, event.data);
      res.status(204).end();
    } catch {
      res.status(400).send('invalid signature');
    }
  },
);
```

> **Important:** pass the **raw body**, not the parsed JSON. `express.json()` will reformat keys/whitespace and break signature verification.

> **Note:** Outbound webhook delivery from Langos is on the v1.x roadmap. The verification helper ships now so you can wire your handler ahead of GA without an SDK upgrade later.

## Configuration

```ts
const client = new Langos({
  apiKey: process.env.LANGOS_API_KEY!,
  baseUrl: 'https://app.langos.io/api/v1',  // override for self-host / staging
  timeout: 30_000,                           // ms
  maxRetries: 2,
  appName: 'YourApp/1.0.0',                  // appended to User-Agent
  logger: pino(),                            // optional Pino-shaped logger
  telemetry: false,                          // opt out of X-Langos-Client-Telemetry
  fetch: customFetch,                        // inject custom fetch
});
```

Per-call overrides via `RequestOptions`:

```ts
await client.assessments.list({}, { timeout: 60_000, maxRetries: 5, signal: ac.signal });
```

## License

MIT — see [LICENSE](./LICENSE)
