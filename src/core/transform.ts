// Snake_case <-> camelCase mapping, applied per-resource (explicit, not a deep
// generic walk). Keeps `metadata` and similar opaque blobs un-touched.
//
// Wire-side interfaces are declared INSIDE this file (not exported from
// `src/types.ts`) because they're an implementation detail of the SDK's HTTP
// boundary. Partner code should never reach in and depend on the snake_case
// shapes — anything reusable is normalized into the camelCase types in
// `src/types.ts`.
//
// Conventions:
//   - Optional + nullable fields on the wire are typed as `T | null | undefined`
//     so we can mirror "key omitted" vs "key present but null" without
//     `any`-casts. Both collapse to `null` in the SDK-facing type.
//   - `metadata`-style opaque blobs use `Record<string, unknown>` (or the
//     stricter type if known); we never recurse into them.
//   - Enum-shaped strings (status, billing_cycle, plan_tier) are typed as
//     `string` on the wire and narrowed by a dedicated normalizer with a
//     deploy-skew fallback. Server-side enum additions never throw the SDK.

import type {
  Account,
  AccountStatus,
  Assessment,
  BillingCycle,
  Candidate,
  CandidateStatus,
  Challenge,
  ChallengeStatus,
  PlanCaps,
  Session,
  SessionAnalytics,
  SessionInsights,
  SessionStatus,
  SessionSubmission,
  SessionFeedback,
  CandidateCreateParams,
  WebhookEndpoint,
  WebhookEndpointParams,
} from '../types.js';

/* ============================================================== *
 *                      Wire-side interfaces                      *
 * ============================================================== */

/**
 * Wire envelope for a single `Assessment` row from `/v1/assessments[/:id]`.
 * Any field absent from the response collapses to `null` on the SDK side
 * (see `assessmentFromWire`).
 */
export interface WireAssessment {
  id: string;
  object?: 'assessment';
  name: string;
  description?: string | null;
  challenge_count?: number | null;
  created_at: string;
  updated_at: string;
}

export interface WireChallenge {
  id: string;
  object?: 'challenge';
  title: string;
  description?: string | null;
  language: string;
  difficulty?: string | null;
  category?: string | null;
  time_limit_minutes?: number | null;
  status: string;
  created_at: string;
}

export interface WireCandidate {
  id: string;
  object?: 'candidate';
  email: string;
  name?: string | null;
  assessment_id: string;
  external_id?: string | null;
  status: string;
  invitation_url?: string | null;
  invited_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
  expires_at?: string | null;
  latest_session_id?: string | null;
  score?: number | string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface WireSessionSubmission {
  language?: string | null;
  final_code?: string | null;
  diff?: string | null;
  commit_sha?: string | null;
  preview_url?: string | null;
}

export interface WireSessionFeedback {
  notes?: string | null;
  problem_solving_score?: number | string | null;
  code_quality_score?: number | string | null;
}

export interface WireSessionAnalytics {
  editor_event_count?: number | null;
  run_event_count?: number | null;
  test_event_count?: number | null;
  ai_event_count?: number | null;
  paste_event_count?: number | null;
  active_seconds?: number | null;
  idle_seconds?: number | null;
  coding_seconds?: number | null;
}

export interface WireSessionInsights {
  ai_usage_percent?: number | string | null;
  test_pass_rate?: number | string | null;
  code_quality?: Record<string, unknown> | null;
}

export interface WireSession {
  id: string;
  object?: 'session';
  candidate_id: string;
  assessment_id: string;
  status: string;
  attempt?: number | null;
  started_at?: string | null;
  completed_at?: string | null;
  duration_seconds?: number | null;
  score?: number | string | null;
  passed?: boolean | null;
  report_url?: string | null;
  submission?: WireSessionSubmission | null;
  analytics?: WireSessionAnalytics | null;
  insights?: WireSessionInsights | null;
  feedback?: WireSessionFeedback | null;
  created_at: string;
  updated_at: string;
}

export interface WirePlanCaps {
  label?: string | null;
  price_monthly?: number | string | null;
  session_limit?: number | null;
  ready_made_challenges?: number | null;
  custom_challenges_max?: number | null;
  features?: Record<string, boolean> | null;
  support?: string | null;
  popular?: boolean | null;
  contact_sales?: boolean | null;
}

export interface WireAccountIntegration {
  provider?: string | null;
  api_key_prefix?: string | null;
  scopes?: unknown;
  rate_limit_per_minute?: number | null;
  webhook_url?: string | null;
}

export interface WireAccount {
  id: string;
  object?: 'account';
  name: string;
  slug?: string | null;
  plan_tier?: string | null;
  billing_cycle?: string | null;
  status?: string | null;
  sessions_used?: number | null;
  sessions_limit?: number | null;
  sessions_remaining?: number | null;
  trial_ends_at?: string | null;
  features?: {
    web_ide_enabled?: boolean | null;
    replay_enabled?: boolean | null;
    ai_assistance_enabled?: boolean | null;
  } | null;
  plan_caps?: WirePlanCaps | null;
  integration?: WireAccountIntegration | null;
}

export interface WireWebhookEndpoint {
  object?: 'webhook_endpoint';
  webhook_url?: string | null;
  signing_secret?: string | null;
}

/* ============================================================== *
 *                    Small helpers (private)                     *
 * ============================================================== */

/**
 * Coerce a wire numeric field that may arrive as `number`, numeric string
 * (Postgres `NUMERIC` columns serialize this way through some drivers),
 * `null`, or `undefined`. Returns `null` for the absent case so the SDK
 * type stays `number | null` instead of `number | null | undefined`.
 */
function numOrNull(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/* ============================================================== *
 *                          assessment                            *
 * ============================================================== */

export function assessmentFromWire(w: WireAssessment): Assessment {
  return {
    id: String(w.id),
    object: 'assessment',
    name: String(w.name),
    description: w.description ?? null,
    challengeCount: Number(w.challenge_count ?? 0),
    createdAt: String(w.created_at),
    updatedAt: String(w.updated_at),
  };
}

/* ============================================================== *
 *                           challenge                            *
 * ============================================================== */

const CHALLENGE_STATUSES: ReadonlyArray<ChallengeStatus> = ['draft', 'published', 'archived'];

function challengeStatusFromWire(raw: string): ChallengeStatus {
  // Forward-compat: server may add new statuses (e.g. `'review'`). Default to
  // `'draft'` so the SDK never throws and partners see a clearly inert state.
  return (CHALLENGE_STATUSES as ReadonlyArray<string>).includes(raw)
    ? (raw as ChallengeStatus)
    : 'draft';
}

export function challengeFromWire(w: WireChallenge): Challenge {
  return {
    id: String(w.id),
    object: 'challenge',
    title: String(w.title),
    description: w.description ?? null,
    language: String(w.language),
    difficulty: w.difficulty ?? null,
    category: w.category ?? null,
    timeLimitMinutes: w.time_limit_minutes ?? null,
    status: challengeStatusFromWire(String(w.status)),
    createdAt: String(w.created_at),
  };
}

/* ============================================================== *
 *                           candidate                            *
 * ============================================================== */

const CANDIDATE_STATUSES: ReadonlyArray<CandidateStatus> = [
  'invited',
  'started',
  'completed',
  'cancelled',
  'error',
];

function candidateStatusFromWire(raw: string): CandidateStatus {
  return (CANDIDATE_STATUSES as ReadonlyArray<string>).includes(raw)
    ? (raw as CandidateStatus)
    : 'error';
}

export function candidateFromWire(w: WireCandidate): Candidate {
  return {
    id: String(w.id),
    object: 'candidate',
    email: String(w.email),
    name: w.name ?? null,
    assessmentId: String(w.assessment_id),
    externalId: w.external_id ?? null,
    status: candidateStatusFromWire(String(w.status)),
    invitationUrl: w.invitation_url ?? null,
    invitedAt: w.invited_at ?? null,
    startedAt: w.started_at ?? null,
    completedAt: w.completed_at ?? null,
    cancelledAt: w.cancelled_at ?? null,
    expiresAt: w.expires_at ?? null,
    latestSessionId: w.latest_session_id ?? null,
    score: numOrNull(w.score),
    metadata: w.metadata ?? null,
    createdAt: String(w.created_at),
    updatedAt: String(w.updated_at),
  };
}

export function candidateCreateToWire(p: CandidateCreateParams): Record<string, unknown> {
  const expires =
    p.expiresAt instanceof Date ? p.expiresAt.toISOString() : p.expiresAt ?? null;
  return {
    email: p.email,
    assessment_id: p.assessmentId,
    name: p.name ?? null,
    external_id: p.externalId ?? null,
    expires_at: expires,
    metadata: p.metadata ?? null,
  };
}

/* ============================================================== *
 *                            session                             *
 * ============================================================== */

const SESSION_STATUSES: ReadonlyArray<SessionStatus> = [
  'pending',
  'provisioning',
  'active',
  'submitted',
  'completed',
  'failed',
  'expired',
];

function sessionStatusFromWire(raw: string): SessionStatus {
  // Forward-compat: unknown statuses fall back to `'pending'` (the most
  // benign state — partners won't trigger "completed" handlers on an
  // unrecognized future status).
  return (SESSION_STATUSES as ReadonlyArray<string>).includes(raw)
    ? (raw as SessionStatus)
    : 'pending';
}

function submissionFromWire(w: WireSessionSubmission | null | undefined): SessionSubmission | null {
  if (!w) return null;
  return {
    language: w.language ?? null,
    finalCode: w.final_code ?? null,
    diff: w.diff ?? null,
    commitSha: w.commit_sha ?? null,
    previewUrl: w.preview_url ?? null,
  };
}

function feedbackFromWire(w: WireSessionFeedback | null | undefined): SessionFeedback | null {
  if (!w) return null;
  return {
    notes: w.notes ?? null,
    problemSolvingScore: numOrNull(w.problem_solving_score),
    codeQualityScore: numOrNull(w.code_quality_score),
  };
}

function analyticsFromWire(w: WireSessionAnalytics | null | undefined): SessionAnalytics {
  const a = w ?? {};
  return {
    editorEventCount: Number(a.editor_event_count ?? 0),
    runEventCount: Number(a.run_event_count ?? 0),
    testEventCount: Number(a.test_event_count ?? 0),
    aiEventCount: Number(a.ai_event_count ?? 0),
    pasteEventCount: Number(a.paste_event_count ?? 0),
    activeSeconds: Number(a.active_seconds ?? 0),
    idleSeconds: Number(a.idle_seconds ?? 0),
    codingSeconds: Number(a.coding_seconds ?? 0),
  };
}

function insightsFromWire(w: WireSessionInsights | null | undefined): SessionInsights | null {
  if (!w) return null;
  return {
    aiUsagePercent: numOrNull(w.ai_usage_percent),
    testPassRate: numOrNull(w.test_pass_rate),
    codeQuality: w.code_quality ?? null,
  };
}

export function sessionFromWire(w: WireSession): Session {
  return {
    id: String(w.id),
    object: 'session',
    candidateId: String(w.candidate_id),
    assessmentId: String(w.assessment_id),
    status: sessionStatusFromWire(String(w.status)),
    attempt: Number(w.attempt ?? 1),
    startedAt: w.started_at ?? null,
    completedAt: w.completed_at ?? null,
    durationSeconds: w.duration_seconds ?? null,
    score: numOrNull(w.score),
    passed: typeof w.passed === 'boolean' ? w.passed : null,
    reportUrl: w.report_url ?? null,
    submission: submissionFromWire(w.submission),
    analytics: analyticsFromWire(w.analytics),
    insights: insightsFromWire(w.insights),
    feedback: feedbackFromWire(w.feedback),
    createdAt: String(w.created_at),
    updatedAt: String(w.updated_at),
  };
}

/* ============================================================== *
 *                            account                             *
 * ============================================================== */

import type { PlanTier } from '../types.js';

const PLAN_TIERS: ReadonlyArray<PlanTier> = ['free', 'starter', 'mid_tier', 'growth', 'custom'];

/**
 * Normalize the wire `plan_tier` to a known {@link PlanTier}. Falls back to
 * `'free'` if the server returns a tier the SDK doesn't recognize — this is a
 * deploy-skew safeguard (older SDK + newer server tier) and gets logged
 * implicitly via the unknown value never matching upgrade-prompt branches.
 */
function planTierFromWire(raw: unknown): PlanTier {
  return typeof raw === 'string' && (PLAN_TIERS as ReadonlyArray<string>).includes(raw)
    ? (raw as PlanTier)
    : 'free';
}

const BILLING_CYCLES: ReadonlyArray<BillingCycle> = ['monthly', 'yearly'];

/**
 * Normalize `billing_cycle`. Returns `null` for `null`/`undefined`/empty (no
 * Stripe subscription on file) AND for any unknown future value — partners
 * never see a thrown error from a forward-compatible server addition.
 */
function billingCycleFromWire(raw: unknown): BillingCycle | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  return (BILLING_CYCLES as ReadonlyArray<string>).includes(raw)
    ? (raw as BillingCycle)
    : null;
}

const ACCOUNT_STATUSES: ReadonlyArray<AccountStatus> = [
  'trialing',
  'active',
  'past_due',
  'canceled',
  'pending',
];

/**
 * Normalize `status`. Falls back to `'active'` for unknown values rather
 * than throwing — `'active'` is the most permissive default (partners won't
 * accidentally render "subscription past due" warnings for an enum value the
 * SDK doesn't know yet).
 */
function accountStatusFromWire(raw: unknown): AccountStatus {
  return typeof raw === 'string' && (ACCOUNT_STATUSES as ReadonlyArray<string>).includes(raw)
    ? (raw as AccountStatus)
    : 'active';
}

function planCapsFromWire(w: WirePlanCaps | null | undefined): PlanCaps | null {
  if (!w) return null;
  return {
    label: String(w.label ?? ''),
    priceMonthly: numOrNull(w.price_monthly),
    billing: 'monthly',
    currency: 'USD',
    sessionLimit: w.session_limit ?? null,
    readyMadeChallenges: w.ready_made_challenges ?? null,
    customChallengesMax: w.custom_challenges_max ?? null,
    features: w.features ?? {},
    support: String(w.support ?? ''),
    popular: w.popular === true,
    contactSales: w.contact_sales === true,
  };
}

export function accountFromWire(w: WireAccount): Account {
  const integ = w.integration ?? {};
  return {
    id: String(w.id),
    object: 'account',
    name: String(w.name),
    slug: String(w.slug ?? ''),
    planTier: planTierFromWire(w.plan_tier),
    billingCycle: billingCycleFromWire(w.billing_cycle),
    status: accountStatusFromWire(w.status),
    sessionsUsed: Number(w.sessions_used ?? 0),
    sessionsLimit: w.sessions_limit ?? null,
    sessionsRemaining: w.sessions_remaining ?? null,
    trialEndsAt: w.trial_ends_at ?? null,
    features: {
      webIdeEnabled: !!w.features?.web_ide_enabled,
      replayEnabled: !!w.features?.replay_enabled,
      aiAssistanceEnabled: !!w.features?.ai_assistance_enabled,
    },
    planCaps: planCapsFromWire(w.plan_caps),
    integration: {
      provider: String(integ.provider ?? ''),
      apiKeyPrefix: String(integ.api_key_prefix ?? ''),
      scopes: Array.isArray(integ.scopes) ? integ.scopes.map(String) : [],
      rateLimitPerMinute: integ.rate_limit_per_minute ?? null,
      webhookUrl: integ.webhook_url ?? null,
    },
  };
}

/* ============================================================== *
 *                       webhook endpoint                         *
 * ============================================================== */

export function webhookEndpointFromWire(w: WireWebhookEndpoint): WebhookEndpoint {
  return {
    object: 'webhook_endpoint',
    webhookUrl: w.webhook_url ?? null,
    signingSecret: w.signing_secret ?? null,
  };
}

export function webhookEndpointParamsToWire(p: WebhookEndpointParams): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (p.webhookUrl !== undefined) out.webhook_url = p.webhookUrl;
  if (p.rotateSigningSecret !== undefined) out.rotate_signing_secret = p.rotateSigningSecret;
  return out;
}
