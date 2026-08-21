import { pool as defaultPool } from "@workspace/db";

import type {
  AssistantChangeProposalInput,
  AssistantChangeProposalView,
  AssistantJobClaim,
  AssistantJobProgress,
  AssistantJobView,
  WebsiteAuditFindingInput,
  WebsiteAuditFindingView,
} from "./assistant-job-types";

type QueryResult = { rows: any[] };
type QueryDb = { query(sql: string, params?: unknown[]): Promise<QueryResult> };

const emptyProgress: AssistantJobProgress = {
  total: 0,
  processed: 0,
  verified: 0,
  broken: 0,
  mismatches: 0,
  review: 0,
  proposedFixes: 0,
  cursorAfterId: null,
};

function iso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function jsonArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function progressFrom(value: unknown): AssistantJobProgress {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...emptyProgress };
  const row = value as Record<string, unknown>;
  return {
    total: Math.max(0, Number(row["total"] ?? 0) || 0),
    processed: Math.max(0, Number(row["processed"] ?? 0) || 0),
    verified: Math.max(0, Number(row["verified"] ?? 0) || 0),
    broken: Math.max(0, Number(row["broken"] ?? 0) || 0),
    mismatches: Math.max(0, Number(row["mismatches"] ?? 0) || 0),
    review: Math.max(0, Number(row["review"] ?? 0) || 0),
    proposedFixes: Math.max(0, Number(row["proposedFixes"] ?? 0) || 0),
    cursorAfterId: typeof row["cursorAfterId"] === "string" ? row["cursorAfterId"] : null,
  };
}

function findingFromRow(row: any): WebsiteAuditFindingView {
  return {
    id: String(row.id),
    recordId: String(row.record_id),
    recordLabel: String(row.record_label),
    savedUrl: String(row.saved_url),
    finalUrl: row.final_url ?? null,
    status: row.status,
    confidence: row.confidence,
    reasons: jsonArray(row.reasons),
    suggestedUrl: row.suggested_url ?? null,
    sourceRefs: jsonArray(row.source_refs),
  };
}

function proposalFromRow(row: any): AssistantChangeProposalView {
  return {
    id: String(row.id),
    recordId: String(row.record_id),
    field: "website",
    oldValue: row.old_value ?? null,
    newValue: row.new_value ?? null,
    confidence: row.confidence,
    reasons: jsonArray(row.reasons),
    status: row.status,
    approvedBy: row.approved_by ?? null,
    approvedAt: iso(row.approved_at),
    appliedAt: iso(row.applied_at),
    failureMessage: row.failure_message ?? null,
  };
}

export class AssistantJobRepository {
  constructor(private readonly db: QueryDb = defaultPool as unknown as QueryDb) {}

  async createJob(input: {
    actorId: string;
    instruction: string;
    normalizedCommand: Record<string, unknown>;
  }): Promise<string> {
    const result = await this.db.query(
      `insert into assistant_jobs
        (actor_id, capability, original_instruction, normalized_command, status, stage)
       values ($1, 'website_verification', $2, $3::jsonb, 'queued', 'queued')
       returning id`,
      [input.actorId, input.instruction.trim().slice(0, 4000), JSON.stringify(input.normalizedCommand)],
    );
    return String(result.rows[0]?.id);
  }

  async getJob(input: { actorId: string; jobId: string }): Promise<AssistantJobView | null> {
    const jobResult = await this.db.query(
      `select * from assistant_jobs where id=$1 and actor_id=$2`,
      [input.jobId, input.actorId],
    );
    const row = jobResult.rows[0];
    if (!row) return null;
    const [findingResult, proposalResult] = await Promise.all([
      this.db.query(`select * from assistant_job_findings where job_id=$1 order by created_at, id`, [input.jobId]),
      this.db.query(`select * from assistant_change_proposals where job_id=$1 order by created_at, id`, [input.jobId]),
    ]);
    return {
      id: String(row.id),
      capability: "website_verification",
      originalInstruction: String(row.original_instruction),
      normalizedCommand: row.normalized_command && typeof row.normalized_command === "object" ? row.normalized_command : {},
      status: row.status,
      stage: String(row.stage),
      progress: progressFrom(row.progress),
      findings: findingResult.rows.map(findingFromRow),
      proposals: proposalResult.rows.map(proposalFromRow),
      createdAt: iso(row.created_at) ?? new Date(0).toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date(0).toISOString(),
      completedAt: iso(row.completed_at),
      failureMessage: row.failure_message ?? null,
    };
  }

  async getLatestJob(actorId: string): Promise<AssistantJobView | null> {
    const result = await this.db.query(
      `select id from assistant_jobs where actor_id=$1 order by created_at desc, id desc limit 1`,
      [actorId],
    );
    return result.rows[0]?.id
      ? this.getJob({ actorId, jobId: String(result.rows[0].id) })
      : null;
  }

  async claimRunnable(input: { workerId: string; now: Date; leaseMs: number }): Promise<AssistantJobClaim | null> {
    const expires = new Date(input.now.getTime() + Math.max(1_000, input.leaseMs));
    const result = await this.db.query(
      `with claimable as (
         select id from assistant_jobs
         where status in ('queued','running','stopping')
           and (worker_id is null or lease_expires_at is null or lease_expires_at <= $2)
         order by updated_at, created_at
         for update skip locked
         limit 1
       )
       update assistant_jobs job
       set worker_id=$1,
           lease_expires_at=$3,
           attempt_count=attempt_count+1,
           status=case when job.status='queued' then 'running' else job.status end,
           stage=case when job.stage='queued' then 'checking_websites' else job.stage end,
           updated_at=$2
       from claimable
       where job.id=claimable.id
       returning job.id, job.actor_id, job.capability, job.normalized_command,
                 job.status, job.stage, job.worker_id, job.lease_expires_at`,
      [input.workerId, input.now.toISOString(), expires.toISOString()],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      jobId: String(row.id),
      actorId: String(row.actor_id),
      capability: "website_verification",
      normalizedCommand: row.normalized_command ?? {},
      status: row.status,
      stage: String(row.stage),
      workerId: String(row.worker_id),
      leaseExpiresAt: iso(row.lease_expires_at) ?? expires.toISOString(),
    };
  }

  async renewLease(jobId: string, workerId: string, now: Date, leaseMs: number): Promise<boolean> {
    const expires = new Date(now.getTime() + Math.max(1_000, leaseMs));
    const result = await this.db.query(
      `update assistant_jobs set lease_expires_at=$4, updated_at=$3
       where id=$1 and worker_id=$2 and status='running' returning id`,
      [jobId, workerId, now.toISOString(), expires.toISOString()],
    );
    return result.rows.length > 0;
  }

  async isCancellationRequested(jobId: string): Promise<boolean> {
    const result = await this.db.query(
      `select cancel_requested_at, status from assistant_jobs where id=$1`,
      [jobId],
    );
    const row = result.rows[0];
    return Boolean(row && (row.cancel_requested_at || row.status === "stopping" || row.status === "stopped"));
  }

  async requestStop(jobId: string, actorId: string): Promise<boolean> {
    const result = await this.db.query(
      `update assistant_jobs
       set status='stopping', cancel_requested_at=coalesce(cancel_requested_at, now()), updated_at=now()
       where id=$1 and actor_id=$2 and status in ('queued','running','stopping') returning id`,
      [jobId, actorId],
    );
    return result.rows.length > 0;
  }

  async markStopped(jobId: string): Promise<void> {
    await this.db.query(
      `update assistant_jobs set status='stopped', worker_id=null, lease_expires_at=null, updated_at=now()
       where id=$1`,
      [jobId],
    );
  }

  async continueJob(jobId: string, actorId: string): Promise<boolean> {
    const result = await this.db.query(
      `update assistant_jobs
       set status='queued', cancel_requested_at=null, worker_id=null, lease_expires_at=null,
           completed_at=null, failure_message=null, updated_at=now()
       where id=$1 and actor_id=$2 and status='stopped' returning id`,
      [jobId, actorId],
    );
    return result.rows.length > 0;
  }

  async updateProgress(jobId: string, patch: Partial<AssistantJobProgress> & { stage?: string }): Promise<void> {
    const bounded: Record<string, unknown> = {};
    for (const key of ["total", "processed", "verified", "broken", "mismatches", "review", "proposedFixes"] as const) {
      if (patch[key] !== undefined) bounded[key] = Math.max(0, Math.floor(Number(patch[key]) || 0));
    }
    if (patch.cursorAfterId !== undefined) bounded.cursorAfterId = patch.cursorAfterId;
    await this.db.query(
      `update assistant_jobs
       set progress=progress || $2::jsonb, stage=coalesce($3, stage), updated_at=now()
       where id=$1`,
      [jobId, JSON.stringify(bounded), patch.stage ?? null],
    );
  }

  async upsertFinding(jobId: string, finding: WebsiteAuditFindingInput): Promise<void> {
    await this.db.query(
      `insert into assistant_job_findings
       (job_id, record_id, record_label, saved_url, final_url, status, confidence, reasons, suggested_url, source_refs)
       values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb)
       on conflict (job_id, record_id) do update set
         record_label=excluded.record_label,
         saved_url=excluded.saved_url,
         final_url=excluded.final_url,
         status=excluded.status,
         confidence=excluded.confidence,
         reasons=excluded.reasons,
         suggested_url=excluded.suggested_url,
         source_refs=excluded.source_refs,
         updated_at=now()`,
      [jobId, finding.recordId, finding.recordLabel.slice(0, 300), finding.savedUrl.slice(0, 2000),
        finding.finalUrl?.slice(0, 2000) ?? null, finding.status, finding.confidence,
        JSON.stringify(finding.reasons.slice(0, 10)), finding.suggestedUrl?.slice(0, 2000) ?? null,
        JSON.stringify(finding.sourceRefs.slice(0, 10))],
    );
  }

  async upsertProposal(jobId: string, proposal: AssistantChangeProposalInput): Promise<void> {
    await this.db.query(
      `insert into assistant_change_proposals
       (job_id, record_id, field, old_value, new_value, confidence, reasons)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb)
       on conflict (job_id, record_id, field) do update set
         old_value=excluded.old_value,
         new_value=excluded.new_value,
         confidence=excluded.confidence,
         reasons=excluded.reasons
       where assistant_change_proposals.status='proposed'`,
      [jobId, proposal.recordId, proposal.field, proposal.oldValue?.slice(0, 2000) ?? null,
        proposal.newValue?.slice(0, 2000) ?? null, proposal.confidence,
        JSON.stringify(proposal.reasons.slice(0, 10))],
    );
  }

  async markComplete(jobId: string): Promise<void> {
    await this.db.query(
      `update assistant_jobs set status='complete', stage='complete', completed_at=now(),
       worker_id=null, lease_expires_at=null, updated_at=now() where id=$1`,
      [jobId],
    );
  }

  async markFailed(jobId: string, message: string): Promise<void> {
    await this.db.query(
      `update assistant_jobs set status='failed', stage='failed', completed_at=now(),
       failure_message=$2, worker_id=null, lease_expires_at=null, updated_at=now() where id=$1`,
      [jobId, message.slice(0, 1000)],
    );
  }
}
