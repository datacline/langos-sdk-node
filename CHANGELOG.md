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

### Added
- **`LangosWebhookPayloadError`.** New error class for webhook payloads that pass signature verification but cannot be parsed as JSON. Re-exported from the package root.
- **`maxRetryAfterMs` client option.** Configurable upper bound (default `300_000`) on how long the SDK will wait when honoring a `Retry-After` header.
- **`client.challenges` resource.** `list({status, language, limit, cursor})` and `retrieve(id)` for the read-only `/v1/challenges` and `/v1/challenges/:id` endpoints. Lets partners discover available coding challenges in the customer's library before assigning them to candidates.
- **`Challenge`, `ChallengeListParams`, `ChallengeStatus` types.** Re-exported from the package root.
- **`challengeFromWire` transform** with unit-test coverage for both fully-populated and minimum-fields shapes.

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
