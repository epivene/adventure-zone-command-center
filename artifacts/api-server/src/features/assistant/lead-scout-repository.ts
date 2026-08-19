import { pool as defaultPool } from "@workspace/db";

import type {
  AssistantLeadMatch,
  LeadDiscoveryCriteria,
  LeadScoutCandidateFactView,
  LeadScoutCandidateView,
  LeadScoutProgress,
  LeadScoutRunView,
  LeadScoutSourceView,
} from "./lead-scout-types";

type QueryResult = { rows: any[] };
type LeadScoutQueryDb = {
  query(sql: string, params?: unknown[]): Promise<QueryResult>;
};

const emptyProgress: LeadScoutProgress = {
  label: null,
  sourcesChecked: 0,
  candidatesFound: 0,
  candidatesEnriched: 0,
  candidatesCompared: 0,
};

function iso(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function dateOnly(value: unknown) {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function jsonArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function progressFromRow(value: unknown): LeadScoutProgress {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...emptyProgress };
  const row = value as Record<string, unknown>;
  return {
    label: typeof row.label === "string" ? row.label : null,
    sourcesChecked: Number(row.sourcesChecked ?? 0),
    candidatesFound: Number(row.candidatesFound ?? 0),
    candidatesEnriched: Number(row.candidatesEnriched ?? 0),
    candidatesCompared: Number(row.candidatesCompared ?? 0),
  };
}

function sourceFromRow(row: any): LeadScoutSourceView {
  return {
    id: String(row.id),
    url: String(row.url),
    title: String(row.title),
    publisher: row.publisher ?? null,
    category: row.category,
    retrievedAt: iso(row.retrieved_at) ?? new Date(0).toISOString(),
  };
}

function factFromRow(row: any): LeadScoutCandidateFactView {
  return {
    id: String(row.id),
    key: String(row.fact_key),
    value: row.fact_value ?? null,
    category: String(row.category),
    confidence: row.confidence,
    rationale: String(row.rationale),
    sourceIds: jsonArray<string>(row.source_ids),
  };
}

function candidateFromRow(row: any, facts: LeadScoutCandidateFactView[]): LeadScoutCandidateView {
  return {
    id: String(row.id),
    name: String(row.name),
    city: row.city ?? null,
    region: row.region ?? null,
    venue: row.venue ?? null,
    startsAt: dateOnly(row.starts_at),
    endsAt: dateOnly(row.ends_at),
    organizerName: row.organizer_name ?? null,
    organizerEmail: row.organizer_email ?? null,
    organizerPhone: row.organizer_phone ?? null,
    website: row.website ?? null,
    eventType: row.event_type ?? null,
    recurrenceSummary: row.recurrence_summary ?? null,
    attendanceSummary: row.attendance_summary ?? null,
    vendorSummary: row.vendor_summary ?? null,
    applicationDeadline: dateOnly(row.application_deadline),
    fitScore: row.fit_score == null ? null : Number(row.fit_score),
    fitRationale: row.fit_rationale ?? null,
    crmMatchStatus: row.crm_match_status,
    matchedOrganizationId: row.matched_organization_id ?? null,
    matchedBookingId: row.matched_booking_id ?? null,
    reviewStatus: row.review_status,
    savedOrganizationId: row.saved_organization_id ?? null,
    savedBookingId: row.saved_booking_id ?? null,
    facts,
  };
}

export class LeadScoutRepository {
  constructor(private readonly db: LeadScoutQueryDb = defaultPool as unknown as LeadScoutQueryDb) {}

  async createRun(input: {
    actorId: string;
    question: string;
    criteria: LeadDiscoveryCriteria | null;
    criteriaSummary: string | null;
  }): Promise<string> {
    const result = await this.db.query(
      `insert into lead_scout_runs
        (actor_id, original_question, criteria, criteria_summary, status, stage)
       values ($1, $2, $3::jsonb, $4, 'interpreting', 'interpreting')
       returning id`,
      [
        input.actorId,
        input.question.trim().slice(0, 4000),
        input.criteria ? JSON.stringify(input.criteria) : null,
        input.criteriaSummary?.trim().slice(0, 1000) || null,
      ],
    );
    return String(result.rows[0]?.id);
  }

  async getRun(input: { actorId: string; runId: string }): Promise<LeadScoutRunView | null> {
    const runResult = await this.db.query(
      `select * from lead_scout_runs where id = $1 and actor_id = $2`,
      [input.runId, input.actorId],
    );
    const row = runResult.rows[0];
    if (!row) return null;

    const [sourceResult, candidateResult, factResult] = await Promise.all([
      this.db.query(
        `select * from lead_scout_sources where run_id = $1 order by created_at, id`,
        [input.runId],
      ),
      this.db.query(
        `select * from lead_scout_candidates where run_id = $1 order by fit_score desc nulls last, created_at, id`,
        [input.runId],
      ),
      this.db.query(
        `select fact.*, candidate.run_id
         from lead_scout_candidate_facts fact
         join lead_scout_candidates candidate on candidate.id = fact.candidate_id
         where candidate.run_id = $1
         order by fact.created_at, fact.id`,
        [input.runId],
      ),
    ]);

    const factsByCandidate = new Map<string, LeadScoutCandidateFactView[]>();
    for (const factRow of factResult.rows) {
      const candidateId = String(factRow.candidate_id);
      const current = factsByCandidate.get(candidateId) ?? [];
      current.push(factFromRow(factRow));
      factsByCandidate.set(candidateId, current);
    }

    return {
      id: String(row.id),
      originalQuestion: String(row.original_question),
      criteria: row.criteria ?? null,
      criteriaSummary: row.criteria_summary ?? null,
      status: row.status,
      stage: row.stage,
      progress: progressFromRow(row.progress),
      crmMatches: jsonArray<AssistantLeadMatch>(row.crm_matches),
      candidates: candidateResult.rows.map((candidateRow) =>
        candidateFromRow(candidateRow, factsByCandidate.get(String(candidateRow.id)) ?? []),
      ),
      sources: sourceResult.rows.map(sourceFromRow),
      startedAt: iso(row.started_at) ?? new Date(0).toISOString(),
      completedAt: iso(row.completed_at),
      createdAt: iso(row.created_at) ?? new Date(0).toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date(0).toISOString(),
      failureMessage: row.failure_message ?? null,
    };
  }

  async getLatestRun(actorId: string): Promise<LeadScoutRunView | null> {
    const result = await this.db.query(
      `select id from lead_scout_runs where actor_id = $1 order by created_at desc, id desc limit 1`,
      [actorId],
    );
    const runId = result.rows[0]?.id;
    return runId ? this.getRun({ actorId, runId: String(runId) }) : null;
  }

  async setCriteria(runId: string, input: {
    criteria: LeadDiscoveryCriteria;
    criteriaSummary: string;
  }): Promise<void> {
    await this.db.query(
      `update lead_scout_runs
       set criteria = $2::jsonb,
           criteria_summary = $3,
           status = 'crm_search',
           stage = 'crm_search',
           progress = jsonb_set(progress, '{label}', to_jsonb('Searching Command Center'::text)),
           updated_at = now()
       where id = $1`,
      [runId, JSON.stringify(input.criteria), input.criteriaSummary.trim().slice(0, 1000)],
    );
  }

  async setCrmReady(runId: string, matches: AssistantLeadMatch[]): Promise<void> {
    await this.db.query(
      `update lead_scout_runs
       set crm_matches = $2::jsonb,
           status = 'crm_ready',
           stage = 'crm_search',
           progress = jsonb_set(progress, '{label}', to_jsonb('Waiting for web-search approval'::text)),
           updated_at = now()
       where id = $1`,
      [runId, JSON.stringify(matches.slice(0, 20))],
    );
  }

  async setFailed(runId: string, message: string): Promise<void> {
    await this.db.query(
      `update lead_scout_runs
       set status = 'failed',
           failure_message = $2,
           completed_at = now(),
           updated_at = now()
       where id = $1`,
      [runId, message.slice(0, 1000)],
    );
  }
}
