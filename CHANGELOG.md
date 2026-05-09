# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security
- **Webhook signature header hardening.** `Webhooks.constructEvent` now joins multi-value `Langos-Signature` headers (string[] from proxies that split duplicate headers) with `,` so every `v1=` entry from every copy is considered — previously only `[0]` was used and signatures from rotation copies were silently dropped. Empty arrays now throw a clear `LangosSignatureVerificationError` instead of crashing on `[0]!`. Signature headers longer than 4096 characters are rejected before parsing as a CPU-DoS guard against attacker-controlled input.

### Changed
- **Retry-After cap raised from 32s to 5 minutes** and made configurable via the new `maxRetryAfterMs` client option. The previous cap silently truncated realistic rate-limit windows (60–300s), defeating the header. Server-supplied values that are negative, NaN, or exceed the cap now fall back to exponential backoff (rather than silently honoring an attacker-controlled "sleep for 3 years" value).
- **`Webhooks.constructEvent` no longer conflates malformed-JSON payloads with signature failure.** Bodies that pass HMAC verification but fail `JSON.parse` now throw the new `LangosWebhookPayloadError` instead of `LangosSignatureVerificationError` — the two have different operational responses (file an upstream ticket vs rotate the secret).

### Tests
- **`LangosTimeoutError` path**: four tests covering configured timeout, `timeoutMs` value, message content, and per-call `RequestOptions.timeout` override
- **`LangosConnectionError` path**: four tests covering DNS/refused errors, `.cause` propagation, message content, and retry exhaustion (3 total fetch calls on `maxRetries: 2`)
- **`AbortSignal` propagation**: three tests — pre-aborted signal, mid-flight abort, no-retry when signal fires — documenting current raw-throw behaviour (see real bug fix below)
- **Idempotency-Key reuse across retries**: three tests verifying the same auto-generated UUID is sent on every POST attempt, user-supplied key is preserved, and independent calls get distinct keys
- **Retry-After parsing**: eight tests — numeric (small values, capped per `maxRetryAfterMs`), HTTP-date (falls back to exponential), negative, NaN, missing, and two integration tests

### Added
- **`LangosWebhookPayloadError`.** New error class for webhook payloads that pass signature verification but cannot be parsed as JSON. Re-exported from the package root.
- **`maxRetryAfterMs` client option.** Configurable upper bound (default `300_000`) on how long the SDK will wait when honoring a `Retry-After` header.
- **`client.challenges` resource.** `list({status, language, limit, cursor})` and `retrieve(id)` for the read-only `/v1/challenges` and `/v1/challenges/:id` endpoints. Lets partners discover available coding challenges in the customer's library before assigning them to candidates.
- **`Challenge`, `ChallengeListParams`, `ChallengeStatus` types.** Re-exported from the package root.
- **`challengeFromWire` transform** with unit-test coverage for both fully-populated and minimum-fields shapes.
- **`BillingCycle` and `AccountStatus` exported types.** Narrowed unions matching the server contract; partners can now discriminate on these without retyping enum literals.

### Changed
- **Eliminated `any` from wire-handling code.** Every `*FromWire` transform and every `this.get<...>` / `this.post<...>` resource call is now typed against an internal `Wire<Resource>` interface (declared in `src/core/transform.ts`). The SDK no longer takes raw `any` from the HTTP boundary; mismatches surface at compile time.
- **Narrowed `Account.billingCycle`.** Was `string`; now `BillingCycle | null` where `BillingCycle = 'monthly' | 'yearly'`. The server emits `'monthly'` or `'yearly'` (Stripe-aligned); free-tier accounts with no Stripe subscription map to `null`. **Forward-compat:** unknown future values (e.g. `'quarterly'`) collapse to `null` rather than throw.
- **Narrowed `Account.status`.** Was `string`; now `AccountStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'pending'`. Mirrors `normalizeCompanyStatus` on the server. **Forward-compat:** unknown values collapse to `'active'` rather than throw, so partners never see a runtime crash from a server-side enum addition.
- **Tightened resource methods.** `assessments`, `challenges`, `candidates`, `sessions`, and `account` now type their HTTP responses with `WireListResponse<Wire<Resource>>` / `Wire<Resource>` instead of `any`.
- **Dropped the catch-all index signature on `SessionInsights`.** Was `[key: string]: unknown`, which silently widened the typed `aiUsagePercent` and `testPassRate` fields back to `unknown` and defeated narrowing. The SessionInsights interface now exposes only the three documented fields (`aiUsagePercent`, `testPassRate`, `codeQuality`); the server doesn't emit additional keys today, so dropping the index sig has no observed runtime impact.

### Subtle behavior changes — partner action may be required
- **`account.billingCycle` is no longer assignable to arbitrary `string`.** Partners holding the value in a wider variable will need to widen explicitly (`as string`) or, preferably, narrow on the union. If you persisted custom non-canonical billing cycles via SDK before this release, they now appear as `null` rather than the original string.
- **`account.status` is no longer assignable to arbitrary `string`.** Same treatment: partners storing the raw status as a wider type will need an explicit cast. Unknown server statuses now read as `'active'` rather than the raw value.
- **`session.insights[someExtraKey]`** no longer compiles. The catch-all index signature was the only thing letting partners reach in for undocumented keys; if you were doing this, surface the field on the server side or stop relying on it.

### Documentation
- **Broaden audience framing.** README intro now positions the SDK for any hiring workflow integration — not specifically ATS partners.
- **Add `client.account` and `client.challenges` to README Resources table.**
- **Expand error handling import list.** README now imports `LangosConflictError` and `LangosSignatureVerificationError` alongside the other typed errors.
- **Genericize example identifiers.** Removed `greenhouse-app-12345` / `GreenhouseConnector/2.1.0` placeholders from code examples — they implied a specific partner integration we don't ship.
- **Fix `for await` examples in CLAUDE.md.** Examples were missing the `await` on `client.<resource>.list()` (which returns a `Promise<AsyncIterablePage>`) and would have thrown at runtime.
- **Correct default `baseUrl` in CLAUDE.md.** Was documented as `https://api.langos.io/v1`; real default is `https://app.langos.io/api/v1`.
- **Drop stale monorepo references in CLAUDE.md.** Repo is standalone; no more `packages/sdk-node/` paths or pointers to monorepo-internal docs.
- **Document the release pipeline.** CLAUDE.md now describes the `v*`-tag release workflow (no manual `npm publish`).

## [0.2.0-alpha.1] - 2026-05-08

### Added
- **Customer Partner API SDK** — official Node.js / TypeScript client for the Langos Partner API (`@datacline/langos-sdk-node`)
- **Assessment resource** — list published assessments, retrieve by id
- **Candidate resource** — invite candidates to assessments, list, retrieve, cancel invitations
- **Session resource** — retrieve scoring results, analytics, and recruiter reports
- **Account resource** — retrieve workspace plan tier, session quota, feature flags, and webhook configuration
- **Webhook support** — register webhook endpoints, set signing secrets, validate inbound webhook signatures with `Langos.webhooks.constructEvent`
- **Pagination** — async iterable cursor-based pagination on all list endpoints
- **Error handling** — typed error classes: `LangosAPIError`, `LangosAuthenticationError`, `LangosForbiddenError`, `LangosNotFoundError`, `LangosBadRequestError`, `LangosConflictError`, `LangosRateLimitError`, `LangosServerError`, `LangosConnectionError`, `LangosTimeoutError`, `LangosSignatureVerificationError`
- **Automatic retries** — configurable exponential backoff with jitter on 5xx (except 501) and `408`/`429` (max 2 retries by default). `409 Conflict` is intentionally not retried (non-idempotent)
- **Idempotency** — automatic `Idempotency-Key` header generation for safe POST/PATCH/DELETE/PUT, honors `Retry-After` headers
- **Zero runtime dependencies** — uses only Node.js built-ins (`fetch`, `crypto`)
- **Dual module distribution** — ESM (`.mjs`), CommonJS (`.cjs`), and TypeScript declaration files (`.d.ts`)
- **TypeScript first** — full type safety for all resources, error classes, and webhook events
- **Webhook signature verification** — HMAC-SHA256 validation with static `Langos.webhooks.constructEvent` helper

### Configuration
- `apiKey` — required Bearer token for authentication
- `baseUrl` — override default (production) endpoint for staging / self-hosted deploys
- `timeout` — request timeout in milliseconds (default: 30,000)
- `maxRetries` — max retry attempts on retryable errors (default: 2)
- `appName` — optional app name appended to User-Agent
- `logger` — optional Pino-shaped logger for debugging
- `telemetry` — opt out of `X-Langos-Client-Telemetry` header (default: enabled)
- `fetch` — optional custom fetch implementation for advanced use cases (e.g., custom proxies)

### Documentation
- Full integration guide in [CLAUDE.md](./CLAUDE.md) for SDK consumers and contributors
- API reference in [README.md](./README.md) covering quickstart, auth, resources, pagination, errors, webhooks
- Contributing guide in [CONTRIBUTING.md](./CONTRIBUTING.md) with testing and PR submission requirements

### Known Limitations
- Alpha release — surface is small and may change before `1.0.0`
- Webhook delivery from Langos is on the v1.x roadmap; verification helper ships now so integrators can wire handlers ahead of GA

### Development
- **Testing** — unit tests with Vitest (~46 tests, no network dependency)
- **Linting** — TypeScript strict mode with `tsc --noEmit`
- **Build** — dual ESM+CJS build with tsup
- **Package content** — validated tarball contents with `npm pack --dry-run`
- **CI/CD** — GitHub Actions workflow testing Node 18.17, 20, and 22
