// Public user-facing types. camelCase. Mapped to/from the snake_case wire
// format in core/transform.ts.

export type CandidateStatus = 'invited' | 'started' | 'completed' | 'cancelled' | 'error';

export type SessionStatus =
  | 'pending'
  | 'provisioning'
  | 'active'
  | 'submitted'
  | 'completed'
  | 'failed'
  | 'expired';

export interface Assessment {
  id: string;
  object: 'assessment';
  name: string;
  description: string | null;
  challengeCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Candidate {
  id: string;
  object: 'candidate';
  email: string;
  name: string | null;
  assessmentId: string;
  externalId: string | null;
  status: CandidateStatus;
  invitationUrl: string | null;
  invitedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  expiresAt: string | null;
  latestSessionId: string | null;
  score: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionSubmission {
  language: string | null;
  finalCode: string | null;
  diff: string | null;
  commitSha: string | null;
  previewUrl: string | null;
}

export interface SessionInsights {
  aiUsagePercent: number | null;
  testPassRate: number | null;
  codeQuality: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface SessionFeedback {
  notes: string | null;
  problemSolvingScore: number | null;
  codeQualityScore: number | null;
}

/**
 * Typed activity counters surfaced from `session_analytics`. All counts are
 * non-negative integers and default to `0` when no events have been recorded
 * yet (`null` is never returned). Lets partner UIs render "candidate spent
 * X minutes coding, ran tests Y times" without parsing the opaque `insights`
 * JSON blob.
 */
export interface SessionAnalytics {
  editorEventCount: number;
  runEventCount: number;
  testEventCount: number;
  aiEventCount: number;
  pasteEventCount: number;
  activeSeconds: number;
  idleSeconds: number;
  codingSeconds: number;
}

export interface Session {
  id: string;
  object: 'session';
  candidateId: string;
  assessmentId: string;
  status: SessionStatus;
  attempt: number;
  startedAt: string | null;
  completedAt: string | null;
  durationSeconds: number | null;
  score: number | null;
  passed: boolean | null;
  /**
   * Partner-readable HTML report URL. Click-through opens a server-rendered
   * report page for the recruiter (no Langos login required). `null` when the
   * session has no calculated score yet.
   */
  reportUrl: string | null;
  submission: SessionSubmission | null;
  /** Typed activity stats; companion to the opaque `insights` blob. */
  analytics: SessionAnalytics;
  insights: SessionInsights | null;
  feedback: SessionFeedback | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Canonical Langos plan tiers. Mirrors the public pricing page at
 * https://www.langos.io/#pricing — the source of truth lives in the server's
 * `plan-features.json`. No aliases, no synonyms; if a partner sees an unknown
 * value here it's a deploy mismatch, not a plan tier we forgot to add.
 *
 * Note: `mid_tier` is the canonical key. There is no `mid` shorthand.
 */
export type PlanTier = 'free' | 'starter' | 'mid_tier' | 'growth' | 'custom';

/**
 * Account info for the Langos company that owns the calling integration.
 * Returned by `client.account.retrieve()`.
 */
export interface Account {
  id: string;
  object: 'account';
  name: string;
  /**
   * Immutable, auto-assigned URL slug for this company. Stable across the
   * company's lifetime; safe to embed in your UI/links. Server-generated on
   * signup — partners cannot set it.
   */
  slug: string;
  /**
   * The company's current plan tier. One of `free | starter | mid_tier |
   * growth | custom`. Use this to gate UI on `planCaps` rather than hardcoding
   * tier strings.
   */
  planTier: PlanTier;
  billingCycle: string;
  status: string;
  sessionsUsed: number;
  /** `null` on unlimited plans (e.g. `custom`). */
  sessionsLimit: number | null;
  /** `null` on unlimited plans (e.g. `custom`). */
  sessionsRemaining: number | null;
  trialEndsAt: string | null;
  /**
   * Top-level feature flags derived from the plan-features matrix and runtime
   * configuration. Each flag answers "can this account use feature X right now?"
   *
   *   - `webIdeEnabled`        — true when the plan includes the web IDE.
   *   - `replayEnabled`        — true when the plan includes session replay.
   *   - `aiAssistanceEnabled`  — true ONLY when the plan includes AI assistance
   *     AND an Anthropic API key is configured for the company. (Tier alone
   *     isn't enough; AI is gated by tier but inert without a key.)
   */
  features: AccountFeatures;
  /**
   * What the company's plan tier *includes*, mirrored from the public pricing
   * page. Read-only — partners use this to render upgrade prompts (e.g. "your
   * plan caps at 30 sessions/mo, upgrade for unlimited"). `null` when the
   * company is on a legacy or unknown tier.
   */
  planCaps: PlanCaps | null;
  integration: AccountIntegration;
}

/**
 * Plan capability block, mirrored from `plan-features.json` on the server.
 * The shape mirrors the public pricing page: render upgrade prompts from this
 * rather than hardcoding plan limits in your UI.
 */
export interface PlanCaps {
  label: string;
  priceMonthly: number | null;
  /** Billing cadence. Currently always `'monthly'`. */
  billing: 'monthly';
  /** Display currency. Currently always `'USD'`. */
  currency: 'USD';
  /** Sessions per billing period. `null` on unlimited tiers. */
  sessionLimit: number | null;
  /** Library challenges available out of the box. `null` on unlimited tiers. */
  readyMadeChallenges: number | null;
  /** Max custom challenges the company can author. `null` on unlimited tiers. */
  customChallengesMax: number | null;
  /**
   * Raw feature matrix from plan-features.json — keys like `web_ide`,
   * `replay`, `ai_assistance`, `sso`, etc. Prefer the typed `Account.features`
   * for the small set of flags surfaced at top level.
   */
  features: Record<string, boolean>;
  support: string;
  popular: boolean;
  contactSales: boolean;
}

/**
 * Top-level feature flags, derived from `plan_caps.features` plus runtime
 * configuration (see `aiAssistanceEnabled`).
 */
export interface AccountFeatures {
  /** True when `plan_caps.features.web_ide` is true. */
  webIdeEnabled: boolean;
  /** True when `plan_caps.features.replay` is true. */
  replayEnabled: boolean;
  /**
   * True only when `plan_caps.features.ai_assistance` is true AND an
   * Anthropic API key is configured for the company. Without the key, AI is
   * gated by tier but would be inert at runtime.
   */
  aiAssistanceEnabled: boolean;
}

export interface AccountIntegration {
  /**
   * Which integration path issued the calling API key.
   *
   * - `"customer"` — this key was minted from the Langos dashboard and used
   *   directly via this SDK.
   * - `"ashby"` (or another ATS slug) — Langos was wired through your ATS
   *   partner; the customer is operating Langos inside the partner's UI.
   *
   * Both paths surface the same `/v1/account` data and call the same API.
   */
  provider: string;
  apiKeyPrefix: string;
  scopes: string[];
  rateLimitPerMinute: number | null;
  webhookUrl: string | null;
}

export interface WebhookEndpoint {
  object: 'webhook_endpoint';
  webhookUrl: string | null;
  /**
   * The `whsec_…` signing secret. Only returned once, immediately after a
   * `rotateSigningSecret: true` call. Subsequent reads return `null`.
   */
  signingSecret: string | null;
}

export interface WebhookEndpointParams {
  /** Absolute http(s) URL, or `null` to disable outbound delivery. */
  webhookUrl?: string | null;
  /**
   * Generate a fresh signing secret. The previous secret is overwritten
   * and cannot be recovered — store the response value.
   */
  rotateSigningSecret?: boolean;
}

export interface CandidateCreateParams {
  email: string;
  assessmentId: string;
  name?: string;
  externalId?: string;
  expiresAt?: string | Date;
  metadata?: Record<string, unknown>;
}

export interface ListParams {
  limit?: number;
  cursor?: string;
}

export interface CandidateListParams extends ListParams {
  status?: CandidateStatus;
  assessmentId?: string;
}

export interface AssessmentListParams extends ListParams {}
export interface SessionListParams extends ListParams {}

/**
 * Per-call request options. Override SDK defaults (timeout, retries) for a
 * single call, supply an `AbortSignal`, or attach extra headers.
 */
export interface RequestOptions {
  timeout?: number;
  maxRetries?: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  idempotencyKey?: string;
}

export interface Logger {
  debug(obj: object, msg?: string): void;
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export interface LangosOptions {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
  fetch?: typeof fetch;
  logger?: Logger;
  /** Free-form identifier appended to the User-Agent (e.g. "GreenhouseConnector/2.1.0"). */
  appName?: string;
  /** Disables outbound client telemetry header. */
  telemetry?: boolean;
}

export interface PageMeta {
  hasMore: boolean;
  nextCursor: string | null;
}

export interface Page<T> extends PageMeta {
  data: T[];
  /** Fetches the next page. Returns null when `hasMore` is false. */
  getNextPage: () => Promise<Page<T> | null>;
}

export type AsyncIterablePage<T> = AsyncIterable<T> & Page<T>;

// Webhook event types — outbound delivery is roadmap; verification helper ships
// in v1.0 so partners can wire their handlers ahead of GA.
export type WebhookEventType =
  | 'session.submitted'
  | 'session.completed'
  | 'candidate.cancelled';

export interface WebhookEvent<T = unknown> {
  id: string;
  object: 'event';
  type: WebhookEventType;
  createdAt: string;
  data: T;
}
