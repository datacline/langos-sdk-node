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
  // baseUrl optional — defaults to https://api.langos.io/v1
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
// List — async iterable, walks all pages
for await (const a of client.assessments.list()) {
  console.log(a.id, a.name, a.challengeCount);
}

const a = await client.assessments.retrieve('asm_abc');
```

### `client.candidates`
```ts
// Create
const c = await client.candidates.create({
  email, name, assessmentId, externalId,
});

// List (filter by status, assessment, etc.)
for await (const c of client.candidates.list({ status: 'completed' })) {
  ...
}

const c = await client.candidates.retrieve('cand_xyz');

// Cancel — idempotent
await client.candidates.cancel('cand_xyz');

// All sessions for a candidate (re-attempts, etc.)
for await (const s of client.candidates.listSessions('cand_xyz')) {
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

```
packages/sdk-node/
  src/
    index.ts           # Public exports (Langos, error classes, types, webhooks)
    client.ts          # Langos class — constructor, baseUrl, auth, resources
    types.ts           # Public types (PlanCaps, Candidate, Session, webhook events)
    core/
      request.ts       # fetch wrapper: auth header, retry, idempotency
      retry.ts         # exponential backoff for 5xx/408/425/429
      errors.ts        # LangosAPIError + subclasses (Forbidden, RateLimit, ...)
      pagination.ts    # AsyncIterable cursor walker
      transform.ts     # snake_case ↔ camelCase between wire and public API
      idempotency.ts   # auto Idempotency-Key for unsafe methods
    resources/
      account.ts       # client.account
      assessments.ts   # client.assessments
      candidates.ts    # client.candidates
      sessions.ts      # client.sessions
      webhooks.ts      # Langos.webhooks.constructEvent
  test/
    unit/              # vitest, no network — 46 tests, ~1.5s
    integration/       # vitest, live local stack — 36 tests
  tsup.config.ts       # dual ESM+CJS build
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
4. Unit test in `test/unit/<name>.test.ts`
5. Integration test in `test/integration/<name>.test.ts` if it hits a new endpoint
6. Update server-side OpenAPI: `codestream-app/server/docs/v1-openapi.yaml`
7. Update prose docs: `docs/api/{getting-started,lifecycle,...}.md`
8. Bump alpha version in `package.json`

### Adding a webhook event
Update three places in lockstep:
- `src/types.ts` — add to the event union
- `docs/api/lifecycle.md` AND `docs/api/webhooks.md` — payload + when it fires
- Server-side publisher in `codestream-app/server/services/customer/webhookPublisher.js`

### Regenerating prose docs
The OpenAPI spec at `codestream-app/server/docs/v1-openapi.yaml` is the source of truth — the Scalar viewer at `docs/api/index.html` consumes it directly, no codegen step. For prose pages, regenerate by hand from the current SDK + OpenAPI surface.

### Publishing (deferred — needs npm scope claim)
```bash
npm publish --access restricted
```

## Conventions worth preserving

- **Zero runtime deps.** Anything beyond Node built-ins needs justification.
- **camelCase in public API, snake_case on wire.** `core/transform.ts` handles both directions; never leak snake_case into public types.
- **AsyncIterable for lists.** All list endpoints walk pages automatically — no `nextPage()` callbacks.
- **Auto idempotency for unsafe methods.** Generated if caller didn't pass one explicitly.
- **Typed errors.** Don't return raw `Error`; classify into `LangosAPIError` subclasses.
- **No silent retries on 4xx (except 408/425/429).** 5xx retries with exponential backoff.

## Where this is heading

Will extract to `github.com/datacline/langos-sdk-node` once npm scope is claimed. The server-side stays in `langos-ide`. After extraction, this file is the SDK repo's onboarding doc — both AI consumers and AI contributors read it.
