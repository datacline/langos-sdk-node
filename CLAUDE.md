# @datacline/langos-sdk-node — AI integration guide

For AI assistants (Claude, ChatGPT, Cursor, Copilot, etc.) helping a developer wire this SDK into their app. Read this once and you have everything needed to ship a working integration in one shot.

## What this SDK does

Langos runs coding assessments. Customers send invitations to candidates, candidates complete them in our IDE, we score them and send back a webhook with the result + a recruiter-readable report URL.

Your job (helping the developer): wire `@datacline/langos-sdk-node` into their backend so they can send invites, receive results, and route candidates to the right next step in their hiring process.

## Install + auth

```bash
npm install @datacline/langos-sdk-node
# or pnpm add / yarn add
```

```ts
import { Langos } from '@datacline/langos-sdk-node';

const client = new Langos({
  apiKey: process.env.LANGOS_API_KEY!,        // langos_live_... or langos_test_...
  // baseUrl optional — defaults to https://app.langos.io/api/v1
});
```

The API key starts with `langos_live_*` (production) or `langos_test_*` (dev/staging). The customer issues it from the Langos dashboard at Settings → API keys.

## The whole loop, end to end

```ts
// 1. Show quota before letting the recruiter click "Send"
const account = await client.account.retrieve();
if (account.sessionsRemaining === 0) {
  return showUpgradePrompt(account.planTier, account.upgradeUrl);
}

// 2. Send the invite. external_id round-trips so you can correlate the
// webhook back to the candidate row in your DB.
const candidate = await client.candidates.create({
  email: 'jane@example.com',
  name: 'Jane Doe',
  assessmentId: 'asm_abc',
  externalId: 'your-app-candidate-12345',
});

// Email or in-app message this URL to the candidate. They start the
// assessment by clicking it.
emailCandidate(candidate.email, candidate.invitationUrl);

// 3. Listen for the webhook (next section).
// 4. Open candidate.reportUrl in a new tab when the recruiter clicks "View".
```

## Resources (full surface)

### `client.account`
```ts
const account = await client.account.retrieve();
// { planTier, sessionsUsed, sessionsLimit, sessionsRemaining,
//   resetAt, upgradeUrl, planCaps, integration: { webhookUrl, ... } }

// Register / update where Langos sends webhooks.
const wh = await client.account.setWebhookEndpoint({
  webhookUrl: 'https://your-app.example.com/webhooks/langos',
  rotateSigningSecret: true,
});
console.log(wh.signingSecret);  // store this — can't read it back later
```

### `client.assessments`
```ts
// List — async iterable, walks all pages.
// Note: list() returns Promise<AsyncIterablePage>, so the for-await needs `await`.
for await (const a of await client.assessments.list()) {
  console.log(a.id, a.name, a.challengeCount);
}

const a = await client.assessments.retrieve('asm_abc');
```

### `client.challenges`
```ts
// List published challenges available to assign
for await (const ch of await client.challenges.list({ status: 'published', language: 'python' })) {
  console.log(ch.id, ch.title, ch.difficulty, ch.timeLimitMinutes);
}

const ch = await client.challenges.retrieve('ch_abc');
```

### `client.candidates`
```ts
// Create
const c = await client.candidates.create({
  email, name, assessmentId, externalId,
});

// List (filter by status, assessment, etc.)
for await (const c of await client.candidates.list({ status: 'completed' })) {
  ...
}

const c = await client.candidates.retrieve('cand_xyz');

// Cancel — idempotent
await client.candidates.cancel('cand_xyz');

// All sessions for a candidate (re-attempts, etc.)
for await (const s of await client.candidates.listSessions('cand_xyz')) {
  ...
}
```

### `client.sessions`
```ts
const s = await client.sessions.retrieve('ses_abc');
// { id, status, startedAt, completedAt, score, passed, reportUrl, analytics, ... }
```

### `Langos.webhooks` (static, for verifying inbound webhooks)
```ts
const event = Langos.webhooks.constructEvent(rawBody, signatureHeader, signingSecret);
```

## Webhook receiver — copy this pattern

The signing secret is checked against the raw bytes, so you need `express.raw()` (not `express.json()`) on the webhook route:

```ts
import express from 'express';
import { Langos } from '@datacline/langos-sdk-node';

const app = express();

app.post(
  '/webhooks/langos',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    let event;
    try {
      event = Langos.webhooks.constructEvent(
        req.body,
        req.headers['langos-signature'] as string,
        process.env.LANGOS_WEBHOOK_SECRET!,
      );
    } catch (err) {
      return res.status(400).send('invalid signature');
    }

    switch (event.type) {
      case 'session.submitted':
        // Candidate clicked Submit. Score may be null.
        // Use case: flip stage to "review pending" without waiting for scoring.
        break;

      case 'session.completed':
        // Score is calculated. event.data has score, passed, reportUrl, analytics.
        if (event.data.passed) {
          advanceCandidateToNextStage(event.data.candidateId);
        } else {
          rejectCandidate(event.data.candidateId);
        }
        storeReportUrl(event.data.candidateId, event.data.reportUrl);
        break;

      case 'candidate.cancelled':
        // Invite was cancelled (by you via DELETE, or by an admin in Langos).
        markCandidateWithdrawn(event.data.id);
        break;
    }

    // Return 2xx fast — Langos retries 3 times (1s + 4s backoff) on non-2xx.
    res.status(204).end();
  },
);

// JSON parser for everything else, AFTER the raw-body webhook route
app.use(express.json());
```

**Webhook event payload shape (the part you'll use):**

```ts
// session.submitted / session.completed
event.data = {
  id: 'ses_abc',
  candidateId: 'cand_xyz',
  assessmentId: 'asm_abc',
  status: 'submitted' | 'completed',
  score: 87,              // null on session.submitted
  passed: true,           // null on session.submitted
  reportUrl: 'https://...?t=jwt',  // null until score is calculated
  analytics: { activeSeconds, codingSeconds, aiEventCount, ... },
  startedAt, completedAt,
}

// candidate.cancelled
event.data = {
  id: 'cand_xyz',
  email, name, externalId,
  status: 'cancelled',
  cancelledAt,
}
```

## Errors — handle these explicitly

```ts
import {
  LangosAPIError,            // base class for all server-side errors
  LangosForbiddenError,      // 403 — wrong scope, key disabled
  LangosNotFoundError,       // 404
  LangosRateLimitError,      // 429 — has .retryAfter (seconds)
  LangosAuthenticationError, // 401 — bad/missing key
  LangosBadRequestError,     // 400
} from '@datacline/langos-sdk-node';

try {
  await client.candidates.create({ ... });
} catch (err) {
  if (err instanceof LangosAPIError && err.status === 402) {
    // Quota exceeded. err.body has structured info:
    //   { code, sessionsUsed, sessionsLimit, resetAt, upgradeUrl, planTier }
    showUpgradePrompt(err.body.upgradeUrl);
    return;
  }
  if (err instanceof LangosRateLimitError) {
    await sleep(err.retryAfter * 1000);
    return retry();
  }
  if (err instanceof LangosForbiddenError) {
    // Scope missing — customer needs to re-issue the key with the right scope.
    return showReconnectPrompt();
  }
  throw err;
}
```

## Conventions worth knowing

- **camelCase in public API.** Wire format is snake_case but the SDK normalizes both directions. Don't use snake_case in your code.
- **Auto idempotency.** SDK auto-generates an `Idempotency-Key` for unsafe methods (POST/DELETE). If the customer wants to control it (e.g. retry-safe job IDs), pass `idempotencyKey: '...'` as the second arg.
- **AsyncIterable cursor pagination.** All list endpoints are `for await` — no `nextPage()` callbacks. Stop early with `break` if you only need the first match.
- **Zero retries on most 4xx.** SDK only retries 408/425/429 (and all 5xx). 400/403/404 errors throw immediately.

## Common pitfalls

| Don't | Do |
|---|---|
| Poll `client.sessions.retrieve()` in a loop | Listen for the `session.completed` webhook |
| Store the API key in client-side / browser code | Always server-side. Browser → your backend → Langos. |
| `express.json()` on the webhook route | `express.raw({ type: 'application/json' })` — signature is over raw bytes |
| Ignore `external_id` | Round-trip it on `candidates.create({ externalId })` so the webhook lets you correlate back to your DB row |
| Send invites without checking quota first | `client.account.retrieve()` first — show "X invites remaining" in your UI |
| Hardcode pass/fail thresholds | Use `event.data.passed` (set server-side based on the customer's plan_caps) |

## What this SDK is not

- Not for the Langos recruiter dashboard — that's a different product surface
- Not a scheduling tool — Langos doesn't book interviews; use Calendly / Google Calendar
- Not for live coding sessions — those are scheduled in the Langos dashboard, not via API

## When in doubt

The SDK is intentionally thin. The full server surface is at `https://docs.langos.io/api` (OpenAPI viewer). Anything you can do via curl, you can do via this SDK with the same shape.

---

# For SDK contributors

If you're an AI assistant helping a developer **work on this SDK** (not just use it), the rest of this file applies. Above is the consumer integration surface; below is the codebase.

## Layout

This repo is standalone (`github.com/datacline/langos-sdk-node`). Layout:

```
src/
  index.ts             # Public exports (Langos, error classes, types, webhooks)
  client.ts            # Langos class — constructor, baseUrl, auth, resources
  types.ts             # Public types (PlanCaps, Candidate, Challenge, Session, webhook events)
  core/
    request.ts         # fetch wrapper: auth header, retry, idempotency
    retry.ts           # exponential backoff for 5xx/408/429 (409 not retried)
    errors.ts          # LangosAPIError + subclasses (Forbidden, RateLimit, ...)
    pagination.ts      # AsyncIterable cursor walker
    transform.ts       # snake_case ↔ camelCase between wire and public API
    idempotency.ts     # auto Idempotency-Key for unsafe methods
  resources/
    account.ts         # client.account
    assessments.ts     # client.assessments
    candidates.ts      # client.candidates
    challenges.ts      # client.challenges
    sessions.ts        # client.sessions
    webhooks.ts        # Langos.webhooks.constructEvent
test/
  unit/                # vitest, no network — runs in CI on Node 18.17/20/22
  integration/         # vitest, live monorepo stack — gated behind LANGOS_TEST_LIVE
openapi/
  v1-openapi.yaml      # vendored copy of the server's OpenAPI spec
tsup.config.ts         # dual ESM+CJS build
```

## Common dev tasks

```bash
pnpm test                  # unit tests, ~1.5s
pnpm test:integration      # integration (needs `docker compose up -d` + LANGOS_API_KEY)
tsc --noEmit               # type check only
pnpm build                 # tsup → dist/{esm,cjs,types}
```

### Add a new resource
1. `src/resources/<name>.ts` — extend the resource base, define methods
2. Wire into `src/client.ts` as `this.<name> = new <Name>Resource(this)`
3. Public types into `src/types.ts` (camelCase, even if wire is snake_case)
4. `<name>FromWire` transform in `src/core/transform.ts`
5. Re-export type from `src/index.ts`
6. Unit test in `test/unit/transform.test.ts` (transform mapping) — and a resource-level test if methods do something non-trivial
7. Bump version in `package.json` (`0.2.0-alpha.X` → `0.2.0-alpha.X+1`)
8. Add an `sdk-contract` scenario in the monorepo (`examples/demo-customer/scenarios.sh` + `codestream-app/server/tests/sdk/scenariosPerTier.runner.js`) — separate PR after the new SDK version publishes
9. Re-vendor the OpenAPI spec: `pnpm run vendor:openapi` (assumes a sibling `langos-ide` checkout)

### Adding a webhook event
Update both:
- `src/types.ts` — add to `WebhookEventType` union AND extend the `Event` discriminated union with a new `BaseEvent<'foo.bar', FooData>`
- The server-side publisher in the monorepo (separate PR) is the source of truth for which events actually fire — keep this union in lockstep with `services/customer/webhookPublisher.js`

### Regenerating types from OpenAPI
`src/generated/paths.d.ts` is generated from the vendored `openapi/v1-openapi.yaml`. To refresh after a server schema change:

```bash
pnpm run vendor:openapi   # copies from sibling langos-ide checkout
pnpm run generate         # runs openapi-typescript
```

Committed types are the source of truth — CI does not regenerate them.

### Publishing
Triggered by pushing a `v*` tag — `.github/workflows/release.yml` runs lint+build+test, verifies the tag matches `package.json` version, validates the tarball contents, then publishes to npm with provenance and creates a GitHub Release. No manual `npm publish`.

```bash
# After your PR is merged to main:
git checkout main && git pull
git tag v0.2.0-alpha.X
git push origin v0.2.0-alpha.X
# release.yml runs automatically; watch via gh run watch
```

## Conventions worth preserving

- **Zero runtime deps.** Anything beyond Node built-ins needs justification.
- **camelCase in public API, snake_case on wire.** `core/transform.ts` handles both directions; never leak snake_case into public types.
- **AsyncIterable for lists.** All list endpoints walk pages automatically — `list()` returns `Promise<AsyncIterablePage>`, so consumers `for await (... of await client.x.list())`.
- **Auto idempotency for unsafe methods.** Generated if caller didn't pass one explicitly.
- **Typed errors.** Don't return raw `Error`; classify into `LangosAPIError` subclasses.
- **No silent retries on 4xx (except 408/429).** 409 is intentionally not retried (non-idempotent). 5xx (except 501) retries with exponential backoff.
