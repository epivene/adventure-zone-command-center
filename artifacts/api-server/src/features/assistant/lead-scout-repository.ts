import { pool as defaultPool } from "@workspace/db";

import type { RelatedEventCrmMatch } from "@/features/profile-research/profile-research-related-event-matcher";
import type {
  AssistantLeadMatch,
  LeadDiscoveryCriteria,
  LeadScoutCandidateFactView,
  LeadScoutCandidateInput,
  LeadScoutCandidateView,
  LeadScoutProgress,
  LeadScoutProgressPatch,
  LeadScoutRunView,
  LeadScoutSourceInput,
  LeadScoutSourceView,
  LeadScoutWorkClaim,
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

function boundedProgressPatch(patch: LeadScoutProgressPatch) {
  const result: Record<string, unknown> = {};
  if (patch.label !== undefined) result.label = patch.label?.slice(0, 240) ?? null;
  for (const key of ["sourcesChecked", "candidatesFound", "candidatesEnriched", "candidatesCompared"] as const) {
    if (patch[key] !== undefined) result[key] = Math.max(0, Math.floor(Number(patch[key]) || 0));
  }
  return result;
}

function normalizedCandidateKey(candidate: LeadScoutCandidateInput) {
  const norm = (value: string | null | undefined) => (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return [
    norm(candidate.name),
    norm(candidate.city),
    norm(candidate.region).toUpperCase(),
    candidate.startsAt ?? "",
    norm(candidate.website),
  ].join("|");
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

  async startWeb(runId: string, actorId: string): Promise<boolean> {
    const result = await this.db.query(
      `update lead_scout_runs
       set status = 'running', stage = 'source_discovery',
           progress = progress || $3::jsonb,
           web_started_at = coalesce(web_started_at, now()),
           cancel_requested_at = null, completed_at = null, failure_message = null,
           worker_id = null, lease_expires_at = null, updated_at = now()
       where id = $1 and actor_id = $2 and status = 'crm_ready'
       returning id`,
      [runId, actorId, JSON.stringify({ label: "Finding public event sources" })],
    );
    return result.rows.length > 0;
  }

  async requestStop(runId: string, actorId: string): Promise<boolean> {
    const result = await this.db.query(
      `update lead_scout_runs
       set status = 'stopping', cancel_requested_at = coalesce(cancel_requested_at, now()),
           progress = progress || '{"label":"Stopping…"}'::jsonb,
           updated_at = now()
       where id = $1 and actor_id = $2 and status in ('running','stopping')
       returning id`,
      [runId, actorId],
    );
    return result.rows.length > 0;
  }

  async continueWeb(runId: string, actorId: string): Promise<boolean> {
    const result = await this.db.query(
      `update lead_scout_runs
       set status = 'running', cancel_requested_at = null, completed_at = null,
           failure_message = null, worker_id = null, lease_expires_at = null,
           progress = progress || '{"label":"Continuing search"}'::jsonb,
           updated_at = now()
       where id = $1 and actor_id = $2 and status = 'stopped'
       returning id`,
      [runId, actorId],
    );
    return result.rows.length > 0;
  }

  async claimRunnable(input: { workerId: string; now: Date; leaseMs: number }): Promise<LeadScoutWorkClaim | null> {
    const leaseExpiresAt = new Date(input.now.getTime() + Math.max(1_000, input.leaseMs));
    const result = await this.db.query(
      `with claimable as (
         select id from lead_scout_runs
         where status = 'running' and criteria is not null
           and (worker_id is null or worker_id = $1 or lease_expires_at is null or lease_expires_at <= $2)
         order by updated_at, created_at
         for update skip locked
         limit 1
       )
       update lead_scout_runs run
       set worker_id = $1, lease_expires_at = $3, attempt_count = attempt_count + 1, updated_at = $2
       from claimable
       where run.id = claimable.id
       returning run.id, run.actor_id, run.criteria, run.stage, run.worker_id, run.lease_expires_at`,
      [input.workerId, input.now.toISOString(), leaseExpiresAt.toISOString()],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      runId: String(row.id),
      actorId: String(row.actor_id),
      criteria: row.criteria as LeadDiscoveryCriteria,
      stage: row.stage,
      workerId: String(row.worker_id),
      leaseExpiresAt: iso(row.lease_expires_at) ?? leaseExpiresAt.toISOString(),
    };
  }

  async renewLease(runId: string, workerId: string, now: Date, leaseMs: number): Promise<boolean> {
    const expires = new Date(now.getTime() + Math.max(1_000, leaseMs));
    const result = await this.db.query(
      `update lead_scout_runs set lease_expires_at = $4, updated_at = $3
       where id = $1 and worker_id = $2 and status = 'running'
       returning id`,
      [runId, workerId, now.toISOString(), expires.toISOString()],
    );
    return result.rows.length > 0;
  }

  async isCancellationRequested(runId: string): Promise<boolean> {
    const result = await this.db.query(
      `select cancel_requested_at, status from lead_scout_runs where id = $1`,
      [runId],
    );
    const row = result.rows[0];
    return Boolean(row && (row.cancel_requested_at || row.status === "stopping" || row.status === "stopped"));
  }

  async updateProgress(runId: string, patch: LeadScoutProgressPatch): Promise<void> {
    const progress = boundedProgressPatch(patch);
    await this.db.query(
      `update lead_scout_runs
       set progress = progress || $2::jsonb,
           stage = coalesce($3, stage),
           updated_at = now()
       where id = $1`,
      [runId, JSON.stringify(progress), patch.stage ?? null],
    );
  }

  async upsertSources(runId: string, sources: LeadScoutSourceInput[]): Promise<void> {
    for (const source of sources) {
      await this.db.query(
        `insert into lead_scout_sources
          (run_id, url, title, publisher, category, retrieved_at, excerpt)
         values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (run_id, url) do update set
           title = excluded.title, publisher = excluded.publisher, category = excluded.category,
           retrieved_at = excluded.retrieved_at, excerpt = excluded.excerpt`,
        [
          runId,
          source.url.trim().slice(0, 2000),
          source.title.trim().slice(0, 300),
          source.publisher?.trim().slice(0, 200) || null,
          source.category,
          source.retrievedAt,
          (source.excerpt ?? "").slice(0, 1200),
        ],
      );
    }
  }

  async upsertCandidates(runId: string, candidates: LeadScoutCandidateInput[]): Promise<void> {
    for (const candidate of candidates) {
      const key = normalizedCandidateKey(candidate);
      const existing = await this.db.query(
        `select id from lead_scout_candidates
         where run_id = $1
           and lower(trim(name)) = $2
           and coalesce(lower(trim(city)), '') = $3
           and coalesce(upper(trim(region)), '') = $4
           and coalesce(starts_at::text, '') = $5
           and coalesce(lower(trim(website)), '') = $6
         limit 1`,
        [
          runId,
          candidate.name.trim().toLowerCase().replace(/\s+/g, " "),
          (candidate.city ?? "").trim().toLowerCase().replace(/\s+/g, " "),
          (candidate.region ?? "").trim().toUpperCase(),
          candidate.startsAt ?? "",
          (candidate.website ?? "").trim().toLowerCase(),
        ],
      );
      const id = existing.rows[0]?.id;
      if (id) {
        await this.db.query(
          `update lead_scout_candidates set
             name=$2, city=$3, region=$4, venue=$5, starts_at=$6, ends_at=$7,
             website=$8, event_type=$9, fit_rationale=$10, updated_at=now()
           where id=$1`,
          [
            id,
            candidate.name.trim().slice(0, 300),
            candidate.city?.trim().slice(0, 160) || null,
            candidate.region?.trim().toUpperCase().slice(0, 8) || null,
            candidate.venue?.trim().slice(0, 300) || null,
            candidate.startsAt,
            candidate.endsAt,
            candidate.website?.trim().slice(0, 2000) || null,
            candidate.eventType?.trim().slice(0, 160) || null,
            candidate.rationale?.trim().slice(0, 1200) || null,
          ],
        );
      } else {
        await this.db.query(
          `insert into lead_scout_candidates
            (run_id, name, city, region, venue, starts_at, ends_at, website, event_type, fit_rationale)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            runId,
            candidate.name.trim().slice(0, 300),
            candidate.city?.trim().slice(0, 160) || null,
            candidate.region?.trim().toUpperCase().slice(0, 8) || null,
            candidate.venue?.trim().slice(0, 300) || null,
            candidate.startsAt,
            candidate.endsAt,
            candidate.website?.trim().slice(0, 2000) || null,
            candidate.eventType?.trim().slice(0, 160) || null,
            candidate.rationale?.trim().slice(0, 1200) || null,
          ],
        );
      }
      void key;
    }
  }

  async setCandidateCrmMatch(runId: string, candidateId: string, match: RelatedEventCrmMatch): Promise<void> {
    await this.db.query(
      `update lead_scout_candidates set
         crm_match_status = $3,
         matched_organization_id = $4,
         matched_booking_id = $5,
         updated_at = now()
       where id = $2 and run_id = $1`,
      [
        runId,
        candidateId,
        match.status,
        match.status === "new_prospect" ? null : match.organizationId,
        match.status === "new_prospect" ? null : (match.bookingId ?? null),
      ],
    );
  }

  async completeRun(runId: string): Promise<void> {
    await this.db.query(
      `update lead_scout_runs set status='complete', stage='complete', completed_at=now(),
         worker_id=null, lease_expires_at=null, cancel_requested_at=null,
         progress = progress || '{"label":"Search complete"}'::jsonb, updated_at=now()
       where id=$1`,
      [runId],
    );
  }

  async stopRun(runId: string): Promise<void> {
    await this.db.query(
      `update lead_scout_runs set status='stopped', worker_id=null, lease_expires_at=null,
         progress = progress || '{"label":"Search stopped — partial results"}'::jsonb, updated_at=now()
       where id=$1`,
      [runId],
    );
  }

  async failRun(runId: string, message: string): Promise<void> {
    await this.setFailed(runId, message);
  }

  async setFailed(runId: string, message: string): Promise<void> {
    await this.db.query(
      `update lead_scout_runs
       set status = 'failed', failure_message = $2, completed_at = now(),
           worker_id = null, lease_expires_at = null, updated_at = now()
       where id = $1`,
      [runId, message.slice(0, 1000)],
    );
  }
}
