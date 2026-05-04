import { execSync } from 'node:child_process';
import { randomBytes, createHash, randomUUID } from 'node:crypto';

const CONTAINER = 'langos-ide-db-1';
const DB = 'codestream';
const USER = 'codestream';

function psql(sql: string): string {
  // Flatten whitespace; psql -c rejects unescaped newlines. Take first line so
  // we drop the trailing "INSERT 0 1" / "UPDATE 1" status row that some psql
  // versions emit even with -tA.
  const flat = sql.replace(/\s+/g, ' ').trim();
  const out = execSync(`docker exec ${CONTAINER} psql -U ${USER} -d ${DB} -tAc ${JSON.stringify(flat)}`, {
    stdio: ['ignore', 'pipe', 'pipe'],
  }).toString();
  const firstLine = out.split('\n')[0]?.trim() ?? '';
  return firstLine;
}

export interface Seeded {
  apiKey: string;
  companyId: string;
  integrationId: string;
  assessmentTypeId: string;
  challengeId: string;
  baseUrl: string;
}

/** Seed a fully wired tenant + integration + assessment for integration tests. */
export async function seed(): Promise<Seeded> {
  const apiKey = `langos_test_${randomBytes(24).toString('hex')}`;
  const apiKeyPrefix = apiKey.substring(0, 8);
  const apiKeyHash = createHash('sha256').update(apiKey).digest('hex');

  const slug = `sdktest_${randomBytes(4).toString('hex')}`;

  const companyId = psql(`
    INSERT INTO companies (name, slug)
    VALUES ('SDK Test Co ${slug}', '${slug}')
    RETURNING id
  `);

  const integrationId = psql(`
    INSERT INTO ats_integrations (company_id, provider, api_key_hash, api_key_prefix, enabled)
    VALUES ('${companyId}', 'sdk-test', '${apiKeyHash}', '${apiKeyPrefix}', TRUE)
    RETURNING id
  `);

  const challengeId = psql(`
    INSERT INTO challenges (company_id, title, description, language, status, time_limit_minutes)
    VALUES ('${companyId}', 'Test Challenge', 'desc', 'python', 'published', 60)
    RETURNING id
  `);

  const assessmentTypeId = psql(`
    INSERT INTO assessment_types (company_id, name, description, enabled)
    VALUES ('${companyId}', 'Test Assessment', 'desc', TRUE)
    RETURNING id
  `);

  psql(`
    INSERT INTO assessment_type_challenges (assessment_type_id, challenge_id, position)
    VALUES ('${assessmentTypeId}', '${challengeId}', 0)
  `);

  return {
    apiKey,
    companyId,
    integrationId,
    assessmentTypeId,
    challengeId,
    baseUrl: process.env.LANGOS_TEST_BASE_URL || 'http://localhost:3001/api/v1',
  };
}

export async function cleanup(s: Seeded): Promise<void> {
  // ON DELETE CASCADE handles the rest.
  psql(`DELETE FROM companies WHERE id = '${s.companyId}'`);
}

export function setRateLimit(integrationId: string, rpm: number | null): void {
  if (rpm === null) {
    psql(`UPDATE ats_integrations SET rate_limit_per_minute = NULL WHERE id = '${integrationId}'`);
  } else {
    psql(`UPDATE ats_integrations SET rate_limit_per_minute = ${rpm} WHERE id = '${integrationId}'`);
  }
}

export function setScopes(integrationId: string, scopes: string[]): void {
  const arr = `ARRAY[${scopes.map(s => `'${s}'`).join(',')}]::text[]`;
  psql(`UPDATE ats_integrations SET scopes = ${arr} WHERE id = '${integrationId}'`);
}

export function setEnabled(integrationId: string, enabled: boolean): void {
  psql(`UPDATE ats_integrations SET enabled = ${enabled} WHERE id = '${integrationId}'`);
}

export function setPassThreshold(companyId: string, threshold: number | null): void {
  if (threshold === null) {
    psql(`UPDATE company_settings SET pass_threshold = NULL WHERE company_id = '${companyId}'`);
    return;
  }
  // INSERT … ON CONFLICT in case the test seeds a fresh company without a settings row.
  psql(`
    INSERT INTO company_settings (company_id, pass_threshold)
    VALUES ('${companyId}', ${threshold})
    ON CONFLICT (company_id) DO UPDATE SET pass_threshold = EXCLUDED.pass_threshold
  `);
}

export function setPlanQuota(companyId: string, used: number, limit: number | null): void {
  if (limit === null) {
    psql(`UPDATE companies SET sessions_used = ${used}, session_limit = NULL WHERE id = '${companyId}'`);
  } else {
    psql(`UPDATE companies SET sessions_used = ${used}, session_limit = ${limit} WHERE id = '${companyId}'`);
  }
}

export function setWebhookUrl(integrationId: string, url: string | null): void {
  if (url === null) {
    psql(`UPDATE ats_integrations SET webhook_url = NULL WHERE id = '${integrationId}'`);
  } else {
    psql(`UPDATE ats_integrations SET webhook_url = '${url}' WHERE id = '${integrationId}'`);
  }
}

export function setSigningSecret(integrationId: string, secret: string): void {
  psql(`UPDATE ats_integrations SET webhook_signing_secret = '${secret}' WHERE id = '${integrationId}'`);
}

/**
 * Seed a complete session into the test tenant: invitation, assignment, ats_assessment,
 * session row, optional session_analytics row, optional artifacts. Returns identifiers
 * the test can use directly. ON DELETE CASCADE through `companies` cleans it up via
 * `cleanup(s)`.
 */
export interface SeededSession {
  sessionId: string;
  candidateId: string; // ats_assessment row id (the partner-facing "candidate" id)
  assignmentId: string;
}

export function seedSession(
  s: Seeded,
  opts: {
    overallScore?: number | null;
    status?: string;
    activeSeconds?: number;
    codingSeconds?: number;
    idleSeconds?: number;
    editorEvents?: number;
    runEvents?: number;
    testEvents?: number;
    aiEvents?: number;
    pasteEvents?: number;
    finalCode?: string | null;
    diffText?: string | null;
  } = {},
): SeededSession {
  const candidateUserId = randomUUID();
  psql(`
    INSERT INTO profiles (id, email, full_name, role)
    VALUES ('${candidateUserId}', 'cand_${randomBytes(4).toString('hex')}@example.com', 'Test Candidate', 'candidate')
  `);

  const assignmentId = psql(`
    INSERT INTO challenge_assignments (
      company_id, challenge_id, candidate_id, candidate_email, candidate_name, status
    ) VALUES (
      '${s.companyId}', '${s.challengeId}', '${candidateUserId}',
      'cand@example.com', 'Test Candidate', 'completed'
    ) RETURNING id
  `);

  const inviteToken = randomBytes(16).toString('hex');
  const invitationId = psql(`
    INSERT INTO invitations (company_id, assignment_id, invite_token, status)
    VALUES ('${s.companyId}', '${assignmentId}', '${inviteToken}', 'completed')
    RETURNING id
  `);

  const candidateId = psql(`
    INSERT INTO ats_assessments (
      company_id, integration_id, provider, ats_application_id,
      candidate_email, candidate_name, challenge_id,
      assignment_id, invitation_id, status, ats_payload
    ) VALUES (
      '${s.companyId}', '${s.integrationId}', 'sdk-test', 'app_${randomBytes(4).toString('hex')}',
      'cand@example.com', 'Test Candidate', '${s.challengeId}',
      '${assignmentId}', '${invitationId}', 'completed', '{"source":"sdk-test"}'::jsonb
    ) RETURNING id
  `);

  const status = opts.status ?? 'submitted';
  const score = opts.overallScore === null ? 'NULL' : String(opts.overallScore ?? 85);
  const finalCode = opts.finalCode === undefined ? "'def hello():\\n    return 1'" : opts.finalCode === null ? 'NULL' : `'${opts.finalCode.replace(/'/g, "''")}'`;
  const sessionId = psql(`
    INSERT INTO sessions (
      assignment_id, invitation_id, challenge_id, candidate_id, company_id,
      status, attempt_number,
      started_at, completed_at, overall_score, final_code, branch_name
    ) VALUES (
      '${assignmentId}', '${invitationId}', '${s.challengeId}', '${candidateUserId}', '${s.companyId}',
      '${status}', 1,
      NOW() - INTERVAL '30 minutes', NOW(), ${score}, ${finalCode}, 'candidate-branch'
    ) RETURNING id
  `);

  // session_analytics: only insert if the test asked for non-default values.
  const wantAnalytics =
    opts.activeSeconds !== undefined
    || opts.codingSeconds !== undefined
    || opts.idleSeconds !== undefined
    || opts.editorEvents !== undefined
    || opts.runEvents !== undefined
    || opts.testEvents !== undefined
    || opts.aiEvents !== undefined
    || opts.pasteEvents !== undefined;
  if (wantAnalytics) {
    psql(`
      INSERT INTO session_analytics (
        session_id, assignment_id, company_id, challenge_id, candidate_id,
        editor_event_count, run_event_count, test_event_count,
        ai_event_count, paste_event_count,
        active_seconds, idle_seconds, coding_seconds, total_events
      ) VALUES (
        '${sessionId}', '${assignmentId}', '${s.companyId}', '${s.challengeId}', '${candidateUserId}',
        ${opts.editorEvents ?? 0}, ${opts.runEvents ?? 0}, ${opts.testEvents ?? 0},
        ${opts.aiEvents ?? 0}, ${opts.pasteEvents ?? 0},
        ${opts.activeSeconds ?? 0}, ${opts.idleSeconds ?? 0}, ${opts.codingSeconds ?? 0},
        ${(opts.editorEvents ?? 0) + (opts.runEvents ?? 0) + (opts.testEvents ?? 0) + (opts.aiEvents ?? 0) + (opts.pasteEvents ?? 0)}
      )
    `);
  }

  if (opts.diffText) {
    psql(`
      INSERT INTO session_git_artifacts (session_id, diff_text, commit_sha)
      VALUES ('${sessionId}', '${opts.diffText.replace(/'/g, "''")}', 'abc123')
    `);
  }

  return { sessionId, candidateId, assignmentId };
}

export function countWebhookDeliveries(integrationId: string): number {
  const out = psql(
    `SELECT COUNT(*) FROM webhook_deliveries WHERE integration_id = '${integrationId}'`,
  );
  return parseInt(out, 10) || 0;
}

export function getLastDelivery(integrationId: string): {
  eventType: string;
  targetUrl: string;
  attempts: number;
  responseStatus: number | null;
  succeededAt: string | null;
  requestBody: string;
} | null {
  const out = psql(`
    SELECT row_to_json(t)::text FROM (
      SELECT event_type, target_url, attempts,
             response_status, succeeded_at::text AS succeeded_at,
             request_body
      FROM webhook_deliveries
      WHERE integration_id = '${integrationId}'
      ORDER BY created_at DESC
      LIMIT 1
    ) t
  `);
  if (!out) return null;
  let row: any;
  try { row = JSON.parse(out); } catch { return null; }
  return {
    eventType: row.event_type,
    targetUrl: row.target_url,
    attempts: Number(row.attempts ?? 0),
    responseStatus: row.response_status === null || row.response_status === undefined ? null : Number(row.response_status),
    succeededAt: row.succeeded_at ?? null,
    requestBody: row.request_body,
  };
}

export async function waitForDelivery(
  integrationId: string,
  predicate: (delivery: ReturnType<typeof getLastDelivery>) => boolean,
  timeoutMs = 5000,
): Promise<ReturnType<typeof getLastDelivery>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const d = getLastDelivery(integrationId);
    if (d && predicate(d)) return d;
    await new Promise(r => setTimeout(r, 100));
  }
  return getLastDelivery(integrationId);
}
