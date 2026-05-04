import { describe, it, expect } from 'vitest';
import {
  assessmentFromWire,
  candidateFromWire,
  candidateCreateToWire,
  sessionFromWire,
} from '../../src/core/transform.js';

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
