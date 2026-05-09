import { describe, it, expect } from 'vitest';
import {
  accountFromWire,
  assessmentFromWire,
  challengeFromWire,
  candidateFromWire,
  candidateCreateToWire,
  sessionFromWire,
} from '../../src/core/transform.js';

/**
 * Sample wire shape mirroring what `/v1/account` returns post plan-tier
 * consolidation. Keep in sync with `services/customer/v1Service.js#retrieveAccount`.
 */
const ACCOUNT_WIRE_FIXTURE = {
  object: 'account',
  id: 'cmp_01H8XYZ',
  name: 'Acme, Inc.',
  slug: 'acme',
  plan_tier: 'mid_tier',
  billing_cycle: 'monthly',
  status: 'active',
  sessions_used: 7,
  sessions_limit: 10,
  sessions_remaining: 3,
  trial_ends_at: null,
  features: {
    web_ide_enabled: true,
    replay_enabled: true,
    ai_assistance_enabled: true,
  },
  plan_caps: {
    label: 'Mid-tier',
    price_monthly: 190,
    billing: 'monthly',
    currency: 'USD',
    session_limit: 10,
    ready_made_challenges: 5,
    custom_challenges_max: 5,
    features: {
      web_ide: true,
      replay: true,
      ai_assistance: true,
      sso: false,
    },
    support: 'priority_email',
    popular: true,
    contact_sales: false,
  },
  integration: {
    provider: 'customer',
    name: 'Greenhouse Connector',
    api_key_prefix: 'langos_l',
    scopes: ['account:read', 'candidates:write'],
    rate_limit_per_minute: 600,
    webhook_url: 'https://hooks.example.com/langos',
  },
};

describe('transform: assessment', () => {
  it('maps snake_case to camelCase', () => {
    const a = assessmentFromWire({
      id: 'asm_1',
      object: 'assessment',
      name: 'Backend Screen',
      description: null,
      challenge_count: 3,
      created_at: '2026-05-03T00:00:00Z',
      updated_at: '2026-05-03T00:00:00Z',
    });
    expect(a.challengeCount).toBe(3);
    expect(a.createdAt).toBe('2026-05-03T00:00:00Z');
    expect(a.description).toBeNull();
  });
});

describe('transform: challenge', () => {
  it('maps snake_case to camelCase and preserves nullable fields', () => {
    const c = challengeFromWire({
      id: 'ch_1',
      object: 'challenge',
      title: 'Two Sum',
      description: 'Find two numbers that sum to a target.',
      language: 'python',
      difficulty: 'easy',
      category: 'algorithms',
      time_limit_minutes: 30,
      status: 'published',
      created_at: '2026-05-03T00:00:00Z',
    });
    expect(c.id).toBe('ch_1');
    expect(c.object).toBe('challenge');
    expect(c.title).toBe('Two Sum');
    expect(c.timeLimitMinutes).toBe(30);
    expect(c.status).toBe('published');
    expect(c.createdAt).toBe('2026-05-03T00:00:00Z');
  });

  it('coerces missing optional fields to null', () => {
    const c = challengeFromWire({
      id: 'ch_2',
      object: 'challenge',
      title: 'Bare-bones',
      description: null,
      language: 'go',
      difficulty: null,
      category: null,
      time_limit_minutes: null,
      status: 'draft',
      created_at: '2026-05-03T00:00:00Z',
    });
    expect(c.description).toBeNull();
    expect(c.difficulty).toBeNull();
    expect(c.category).toBeNull();
    expect(c.timeLimitMinutes).toBeNull();
  });
});

describe('transform: candidate', () => {
  it('preserves metadata blob untouched', () => {
    const meta = { greenhouse_app_id: 'abc', tags: ['urgent', 'follow-up'] };
    const c = candidateFromWire({
      id: 'cand_1',
      email: 'a@b.com',
      name: null,
      assessment_id: 'asm_1',
      external_id: 'ghx',
      status: 'invited',
      invitation_url: 'https://x',
      invited_at: '2026-05-03T00:00:00Z',
      created_at: '2026-05-03T00:00:00Z',
      updated_at: '2026-05-03T00:00:00Z',
      metadata: meta,
    });
    expect(c.metadata).toEqual(meta);
    expect(c.metadata).toBe(meta);
    expect(c.assessmentId).toBe('asm_1');
    expect(c.externalId).toBe('ghx');
  });

  it('CREATE: maps Date expires_at to ISO string', () => {
    const d = new Date('2026-06-01T00:00:00Z');
    const w = candidateCreateToWire({
      email: 'a@b.com',
      assessmentId: 'asm_1',
      expiresAt: d,
    });
    expect(w.expires_at).toBe('2026-06-01T00:00:00.000Z');
    expect(w.assessment_id).toBe('asm_1');
  });

  it('CREATE: preserves string expires_at', () => {
    const w = candidateCreateToWire({
      email: 'a@b.com',
      assessmentId: 'asm_1',
      expiresAt: '2026-06-01T00:00:00Z',
    });
    expect(w.expires_at).toBe('2026-06-01T00:00:00Z');
  });

  it('CREATE: emits null fields explicitly to avoid hidden defaults', () => {
    const w = candidateCreateToWire({ email: 'a@b.com', assessmentId: 'asm_1' });
    expect(w.name).toBeNull();
    expect(w.external_id).toBeNull();
    expect(w.metadata).toBeNull();
  });
});

describe('transform: account', () => {
  it('maps the post-consolidation /v1/account shape', () => {
    const a = accountFromWire(ACCOUNT_WIRE_FIXTURE);
    expect(a.id).toBe('cmp_01H8XYZ');
    expect(a.slug).toBe('acme');
    expect(a.planTier).toBe('mid_tier');
    expect(a.sessionsRemaining).toBe(3);
    expect(a.features.webIdeEnabled).toBe(true);
    expect(a.features.aiAssistanceEnabled).toBe(true);
    expect(a.planCaps?.label).toBe('Mid-tier');
    expect(a.planCaps?.priceMonthly).toBe(190);
    expect(a.planCaps?.billing).toBe('monthly');
    expect(a.planCaps?.currency).toBe('USD');
    expect(a.planCaps?.sessionLimit).toBe(10);
    expect(a.planCaps?.readyMadeChallenges).toBe(5);
    expect(a.planCaps?.customChallengesMax).toBe(5);
    expect(a.planCaps?.popular).toBe(true);
    expect(a.planCaps?.contactSales).toBe(false);
    expect(a.planCaps?.features.web_ide).toBe(true);
    expect(a.planCaps?.features.sso).toBe(false);
    expect(a.integration.provider).toBe('customer');
    expect(a.integration.scopes).toContain('account:read');
  });

  it('emits empty slug rather than throwing if the server omits it', () => {
    const { slug, ...withoutSlug } = ACCOUNT_WIRE_FIXTURE;
    const a = accountFromWire(withoutSlug);
    expect(a.slug).toBe('');
  });

  it('falls back to "free" for an unknown plan_tier (deploy-skew safe)', () => {
    const a = accountFromWire({ ...ACCOUNT_WIRE_FIXTURE, plan_tier: 'enterprise' });
    expect(a.planTier).toBe('free');
  });

  it('accepts every canonical tier', () => {
    for (const tier of ['free', 'starter', 'mid_tier', 'growth', 'custom']) {
      const a = accountFromWire({ ...ACCOUNT_WIRE_FIXTURE, plan_tier: tier });
      expect(a.planTier).toBe(tier);
    }
  });

  it('maps null caps for unlimited (custom) plans', () => {
    const a = accountFromWire({
      ...ACCOUNT_WIRE_FIXTURE,
      plan_tier: 'custom',
      sessions_limit: null,
      sessions_remaining: null,
      plan_caps: {
        ...ACCOUNT_WIRE_FIXTURE.plan_caps,
        label: 'Custom',
        price_monthly: null,
        session_limit: null,
        ready_made_challenges: null,
        custom_challenges_max: null,
        contact_sales: true,
        popular: false,
      },
    });
    expect(a.sessionsLimit).toBeNull();
    expect(a.sessionsRemaining).toBeNull();
    expect(a.planCaps?.priceMonthly).toBeNull();
    expect(a.planCaps?.sessionLimit).toBeNull();
    expect(a.planCaps?.contactSales).toBe(true);
  });

  it('null plan_caps is preserved (legacy/unknown tier)', () => {
    const a = accountFromWire({ ...ACCOUNT_WIRE_FIXTURE, plan_caps: null });
    expect(a.planCaps).toBeNull();
  });
});

describe('transform: session', () => {
  it('handles missing optional fields', () => {
    const s = sessionFromWire({
      id: 'sess_1',
      object: 'session',
      candidate_id: 'cand_1',
      assessment_id: 'asm_1',
      status: 'completed',
      attempt: 1,
      created_at: '2026-05-03T00:00:00Z',
      updated_at: '2026-05-03T00:00:00Z',
    });
    expect(s.score).toBeNull();
    expect(s.submission).toBeNull();
    expect(s.feedback).toBeNull();
    expect(s.passed).toBeNull();
  });

  it('maps submission and feedback when present', () => {
    const s = sessionFromWire({
      id: 'sess_1',
      object: 'session',
      candidate_id: 'cand_1',
      assessment_id: 'asm_1',
      status: 'completed',
      attempt: 2,
      score: 87,
      submission: {
        language: 'python',
        final_code: 'print(1)',
        diff: '+ print(1)',
        commit_sha: 'abc123',
        preview_url: 'https://x/sessions/sess_1',
      },
      feedback: {
        notes: 'good problem decomposition',
        problem_solving_score: 4,
        code_quality_score: 5,
      },
      created_at: '2026-05-03T00:00:00Z',
      updated_at: '2026-05-03T00:00:00Z',
    });
    expect(s.submission?.finalCode).toBe('print(1)');
    expect(s.submission?.commitSha).toBe('abc123');
    expect(s.feedback?.problemSolvingScore).toBe(4);
    expect(s.feedback?.codeQualityScore).toBe(5);
    expect(s.attempt).toBe(2);
    expect(s.score).toBe(87);
  });
});
