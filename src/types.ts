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
 * Account info for the Langos company that owns the calling integration.
 * Returned by `client.account.retrieve()`.
 */
export interface Account {
  id: string;
  object: 'account';
  name: string;
  planTier: string;
  billingCycle: string;
  status: string;
  sessionsUsed: number;
  /** `null` on unlimited / enterprise plans. */
  sessionsLimit: number | null;
  /** `null` on unlimited / enterprise plans. */
  sessionsRemaining: number | null;
  trialEndsAt: string | null;
  features: AccountFeatures;
  /**
   * What the company's plan tier *includes* per the public pricing page.
   * Read-only — partners use this to render upgrade prompts (e.g. "your plan
   * caps at 30 sessions/mo, upgrade for unlimited"). `null` when the company
   * is on a legacy or unknown tier.
   */
  planCaps: PlanCaps | null;
  integration: AccountIntegration;
}

export interface PlanCaps {
  label: string;
  priceMonthly: number | null;
  billing: string;
  currency: string;
  sessionLimit: number | null;
  readyMadeChallenges: number | null;
  customChallengesMax: number | null;
  features: Record<string, boolean>;
  support: string;
  popular: boolean;
  contactSales: boolean;
}

export interface AccountFeatures {
  webIdeEnabled: boolean;
  replayEnabled: boolean;
  aiAssistanceEnabled: boolean;
}

export interface AccountIntegration {
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
