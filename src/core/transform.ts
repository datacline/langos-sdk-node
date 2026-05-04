// Snake_case <-> camelCase mapping, applied per-resource (explicit, not a deep
// generic walk). Keeps `metadata` and similar opaque blobs un-touched.

import type {
  Account,
  Assessment,
  Candidate,
  Session,
  SessionAnalytics,
  SessionSubmission,
  SessionFeedback,
  CandidateCreateParams,
  WebhookEndpoint,
  WebhookEndpointParams,
} from '../types.js';

/* ------------------------- assessment ------------------------- */

export function assessmentFromWire(w: any): Assessment {
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

/* ------------------------- candidate ------------------------- */

export function candidateFromWire(w: any): Candidate {
  return {
    id: String(w.id),
    object: 'candidate',
    email: String(w.email),
    name: w.name ?? null,
    assessmentId: String(w.assessment_id),
    externalId: w.external_id ?? null,
    status: w.status,
    invitationUrl: w.invitation_url ?? null,
    invitedAt: w.invited_at ?? null,
    startedAt: w.started_at ?? null,
    completedAt: w.completed_at ?? null,
    cancelledAt: w.cancelled_at ?? null,
    expiresAt: w.expires_at ?? null,
    latestSessionId: w.latest_session_id ?? null,
    score: w.score === null || w.score === undefined ? null : Number(w.score),
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

/* ------------------------- session ------------------------- */

function submissionFromWire(w: any): SessionSubmission | null {
  if (!w) return null;
  return {
    language: w.language ?? null,
    finalCode: w.final_code ?? null,
    diff: w.diff ?? null,
    commitSha: w.commit_sha ?? null,
    previewUrl: w.preview_url ?? null,
  };
}

function feedbackFromWire(w: any): SessionFeedback | null {
  if (!w) return null;
  return {
    notes: w.notes ?? null,
    problemSolvingScore:
      w.problem_solving_score === null || w.problem_solving_score === undefined
        ? null
        : Number(w.problem_solving_score),
    codeQualityScore:
      w.code_quality_score === null || w.code_quality_score === undefined
        ? null
        : Number(w.code_quality_score),
  };
}

function analyticsFromWire(w: any): SessionAnalytics {
  const a = w || {};
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

export function sessionFromWire(w: any): Session {
  return {
    id: String(w.id),
    object: 'session',
    candidateId: String(w.candidate_id),
    assessmentId: String(w.assessment_id),
    status: w.status,
    attempt: Number(w.attempt ?? 1),
    startedAt: w.started_at ?? null,
    completedAt: w.completed_at ?? null,
    durationSeconds: w.duration_seconds ?? null,
    score: w.score === null || w.score === undefined ? null : Number(w.score),
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

/* ------------------------- account ------------------------- */

export function accountFromWire(w: any): Account {
  return {
    id: String(w.id),
    object: 'account',
    name: String(w.name),
    planTier: String(w.plan_tier),
    billingCycle: String(w.billing_cycle),
    status: String(w.status),
    sessionsUsed: Number(w.sessions_used ?? 0),
    sessionsLimit:
      w.sessions_limit === null || w.sessions_limit === undefined
        ? null
        : Number(w.sessions_limit),
    sessionsRemaining:
      w.sessions_remaining === null || w.sessions_remaining === undefined
        ? null
        : Number(w.sessions_remaining),
    trialEndsAt: w.trial_ends_at ?? null,
    features: {
      webIdeEnabled: !!w.features?.web_ide_enabled,
      replayEnabled: !!w.features?.replay_enabled,
      aiAssistanceEnabled: !!w.features?.ai_assistance_enabled,
    },
    planCaps: w.plan_caps
      ? {
          label: String(w.plan_caps.label ?? ''),
          priceMonthly:
            w.plan_caps.price_monthly === null || w.plan_caps.price_monthly === undefined
              ? null
              : Number(w.plan_caps.price_monthly),
          billing: String(w.plan_caps.billing ?? 'monthly'),
          currency: String(w.plan_caps.currency ?? 'USD'),
          sessionLimit:
            w.plan_caps.session_limit === null || w.plan_caps.session_limit === undefined
              ? null
              : Number(w.plan_caps.session_limit),
          readyMadeChallenges:
            w.plan_caps.ready_made_challenges === null || w.plan_caps.ready_made_challenges === undefined
              ? null
              : Number(w.plan_caps.ready_made_challenges),
          customChallengesMax:
            w.plan_caps.custom_challenges_max === null || w.plan_caps.custom_challenges_max === undefined
              ? null
              : Number(w.plan_caps.custom_challenges_max),
          features: w.plan_caps.features ?? {},
          support: String(w.plan_caps.support ?? ''),
          popular: w.plan_caps.popular === true,
          contactSales: w.plan_caps.contact_sales === true,
        }
      : null,
    integration: {
      provider: String(w.integration?.provider ?? ''),
      apiKeyPrefix: String(w.integration?.api_key_prefix ?? ''),
      scopes: Array.isArray(w.integration?.scopes) ? w.integration.scopes.map(String) : [],
      rateLimitPerMinute:
        w.integration?.rate_limit_per_minute === null ||
        w.integration?.rate_limit_per_minute === undefined
          ? null
          : Number(w.integration.rate_limit_per_minute),
      webhookUrl: w.integration?.webhook_url ?? null,
    },
  };
}

/* ------------------------- webhook endpoint ------------------------- */

export function webhookEndpointFromWire(w: any): WebhookEndpoint {
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

function insightsFromWire(w: any): Session['insights'] {
  if (!w) return null;
  return {
    aiUsagePercent:
      w.ai_usage_percent === null || w.ai_usage_percent === undefined
        ? null
        : Number(w.ai_usage_percent),
    testPassRate:
      w.test_pass_rate === null || w.test_pass_rate === undefined
        ? null
        : Number(w.test_pass_rate),
    codeQuality: w.code_quality ?? null,
    ...passthroughExtras(w, ['ai_usage_percent', 'test_pass_rate', 'code_quality']),
  };
}

function passthroughExtras(o: Record<string, unknown>, known: string[]) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (!known.includes(k)) out[k] = v;
  }
  return out;
}
