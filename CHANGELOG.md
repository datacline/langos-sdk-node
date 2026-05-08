# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security
- **Webhook empty / short signing secret rejected.** `Webhooks.constructEvent` now requires `secret` to be a non-empty string of at least 16 characters. Prevents a forgery path where a partner who forgot to set `LANGOS_WEBHOOK_SECRET` would silently HMAC events against the empty string, allowing an attacker who knows this default to forge events that pass verification.
- **Webhook timestamp parser hardened.** The `t=` value in the `Langos-Signature` header is now rejected if it is non-positive, NaN, or larger than `2**32` seconds (past the unix-epoch overflow boundary). Previously `t=0` and `t=-1` parsed as valid integers and only failed via the tolerance check, which is a fail-late posture for a malformed-input class.
- **Header injection guard on `appName` and `apiKey`.** The `Langos` constructor now rejects strings containing `\r`, `\n`, `\0`, or any C0 control character. These would otherwise let an attacker who controls the partner's `appName` env splice arbitrary headers into every outbound request via the `User-Agent` line. Same guard applies to `apiKey` for the `Authorization` header.

### Fixed
- **`WebhookEventType` aligned with server-side publishers.** The union now matches the canonical set emitted by the server (`session.submitted`, `session.completed`, `candidate.cancelled`). The previous test fixture referenced a fictional `candidate.completed` event; that has been corrected. Also adds an `Event` discriminated union so partners can `switch (event.type)` and let the compiler enforce exhaustive handling.
- **`409 Conflict` no longer auto-retried.** 409 is non-idempotent (duplicate email, version conflict, race against a parallel mutation) — retrying just burns the partner's rate-limit budget and amplifies the conflict. Partners should surface 409 to their caller and resolve the conflict explicitly.
- **`WebhookEvent.created` matches the server's wire field.** The webhook envelope's timestamp field was typed as `createdAt`, but the server-side publisher emits `created`. Reading `event.createdAt` returned `undefined` at runtime while the type system claimed it was a string. Renamed to `created` on `WebhookEvent` and `BaseEvent` to remove the lie; partners using `event.created` get the real timestamp.

## [0.2.0-alpha.1] - 2026-05-08

### Added
- **Customer Partner API SDK** — official Node.js / TypeScript client for the Langos Partner API (`@datacline/langos-sdk-node`)
- **Assessment resource** — list published assessments, retrieve by id
- **Challenge resource** — list coding challenges, retrieve by id
- **Candidate resource** — invite candidates to assessments, list, retrieve, cancel invitations
- **Session resource** — retrieve scoring results, analytics, and recruiter reports
- **Account resource** — retrieve workspace plan tier, session quota, feature flags, and webhook configuration
- **Webhook support** — register webhook endpoints, set signing secrets, validate inbound webhook signatures with `Langos.webhooks.constructEvent`
- **Pagination** — async iterable cursor-based pagination on all list endpoints
- **Error handling** — typed error classes: `LangosAPIError`, `LangosAuthenticationError`, `LangosForbiddenError`, `LangosNotFoundError`, `LangosBadRequestError`, `LangosRateLimitError`, `LangosServerError`, `LangosConnectionError`, `LangosTimeoutError`
- **Automatic retries** — configurable exponential backoff with jitter on 5xx and `408`/`409`/`429` (max 2 retries by default)
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
