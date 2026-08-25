import { pool as defaultPool } from "@workspace/db";

import { LeadScoutRepository } from "./lead-scout-repository";
import type {
  LeadDiscoveryCriteria,
  LeadScoutCandidateView,
  LeadScoutSourceInput,
} from "./lead-scout-types";
import type {
  ScoutAlertDraft,
  ScoutAlertSnapshot,
  ScoutAlertSource,
  ScoutAlertView,
} from "./scout-alert-types";

type QueryDb = {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
};

export type ScoutAlertWatchClaim = {
  watchId: string;
  workerId: string;
  actorId: string;
  runId: string;
  candidateId: string;
  organizationId: string;
  bookingId: string | null;
  nextResearchAt: string;
  failureCount: number;
  snapshot: ScoutAlertSnapshot | null;
  leaseExpiresAt: string;
};

export type ScoutAlertWatchContext = {
  claim: ScoutAlertWatchClaim;
  profileName: string;
  bookingStatus: string | null;
  bookingEndsAt: string | null;
  criteria: LeadDiscoveryCriteria;
  candidate: LeadScoutCandidateView;
  knownSources: LeadScoutSourceInput[];
};

function iso(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function dateOnly(value: unknown) {
  return iso(value)?.slice(0, 10) ?? null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function safeUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? value : null;
  } catch {
    return null;
  }
}

function sources(value: unknown): ScoutAlertSource[] {
  if (!Array.isArray(value)) return [];
  const result: ScoutAlertSource[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const row = record(item);
    const url = safeUrl(row?.url);
    if (!row || !url || seen.has(url)) continue;
    seen.add(url);
    result.push({
      url,
      title: typeof row.title === "string" && row.title.trim() ? row.title.trim().slice(0, 300) : url,
      publisher: typeof row.publisher === "string" && row.publisher.trim()
        ? row.publisher.trim().slice(0, 200)
        : null,
      category: typeof row.category === "string" ? row.category.slice(0, 80) : "other",
      retrievedAt: typeof row.retrievedAt === "string" ? row.retrievedAt : "",
    });
    if (result.length >= 8) break;
  }
  return result;
}

function snapshot(value: unknown): ScoutAlertSnapshot | null {
  const row = record(value);
  if (!row) return null;
  return {
    startsAt: typeof row.startsAt === "string" ? row.startsAt : null,
    endsAt: typeof row.endsAt === "string" ? row.endsAt : null,
    applicationAvailable: row.applicationAvailable === true,
    applicationUrl: safeUrl(row.applicationUrl),
    applicationDeadline: typeof row.applicationDeadline === "string" ? row.applicationDeadline : null,
    organizerName: typeof row.organizerName === "string" ? row.organizerName : null,
    organizerEmail: typeof row.organizerEmail === "string" ? row.organizerEmail : null,
    organizerPhone: typeof row.organizerPhone === "string" ? row.organizerPhone : null,
    coverageGaps: stringArray(row.coverageGaps).slice(0, 20),
    sources: sources(row.sources),
    capturedAt: typeof row.capturedAt === "string" ? row.capturedAt : new Date(0).toISOString(),
  };
}

function alertPayload(alerts: ScoutAlertDraft[]) {
  return alerts.slice(0, 50).map((alert) => ({
    kind: alert.kind,
    severity: alert.severity,
    title: alert.title.slice(0, 180),
    body: alert.body.slice(0, 1_200),
    before_value: alert.beforeValue,
    after_value: alert.afterValue,
    sources: alert.sources.slice(0, 8),
    confidence: alert.confidence,
    fingerprint: alert.fingerprint.slice(0, 200),
    due_at: alert.dueAt,
  }));
}

function alertView(row: any): ScoutAlertView {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    bookingId: row.booking_id ? String(row.booking_id) : null,
    profileName: String(row.profile_name ?? "Scout profile"),
    kind: row.kind,
    severity: row.severity,
    title: String(row.title),
    body: String(row.body),
    beforeValue: row.before_value ?? null,
    afterValue: row.after_value ?? null,
    sources: sources(row.sources),
    confidence: row.confidence ?? null,
    dueAt: iso(row.due_at),
    detectedAt: iso(row.detected_at) ?? new Date(0).toISOString(),
  };
}

export class ScoutAlertRepository {
  private readonly leadScoutRepository: LeadScoutRepository;

  constructor(private readonly db: QueryDb = defaultPool as unknown as QueryDb) {
    this.leadScoutRepository = new LeadScoutRepository(db as never);
  }

  async claimDue(input: {
    workerId: string;
    now: Date;
    leaseMs: number;
  }): Promise<ScoutAlertWatchClaim | null> {
    const leaseExpiresAt = new Date(input.now.getTime() + Math.max(1_000, input.leaseMs));
    const result = await this.db.query(
      `with claimable as (
         select watch.id
         from scout_alert_watches watch
         where watch.status = 'active'
           and least(watch.next_evaluation_at, watch.next_research_at) <= $2
           and (
             watch.worker_id is null
             or watch.worker_id = $1
             or watch.lease_expires_at is null
             or watch.lease_expires_at <= $2
           )
         order by least(watch.next_evaluation_at, watch.next_research_at), watch.created_at, watch.id
         for update skip locked
         limit 1
       )
       update scout_alert_watches watch
       set worker_id = $1,
           lease_expires_at = $3,
           updated_at = $2
       from claimable
       inner join lead_scout_candidates candidate on candidate.id = watch.candidate_id
       where watch.id = claimable.id
       returning watch.id, watch.worker_id, watch.actor_id, candidate.run_id,
         watch.candidate_id, watch.organization_id, watch.booking_id,
         watch.next_research_at, watch.failure_count, watch.snapshot, watch.lease_expires_at`,
      [input.workerId, input.now.toISOString(), leaseExpiresAt.toISOString()],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      watchId: String(row.id),
      workerId: String(row.worker_id),
      actorId: String(row.actor_id),
      runId: String(row.run_id),
      candidateId: String(row.candidate_id),
      organizationId: String(row.organization_id),
      bookingId: row.booking_id ? String(row.booking_id) : null,
      nextResearchAt: iso(row.next_research_at) ?? input.now.toISOString(),
      failureCount: Math.max(0, Number(row.failure_count ?? 0)),
      snapshot: snapshot(row.snapshot),
      leaseExpiresAt: iso(row.lease_expires_at) ?? leaseExpiresAt.toISOString(),
    };
  }

  async loadContext(claim: ScoutAlertWatchClaim): Promise<ScoutAlertWatchContext | null> {
    const linked = await this.db.query(
      `select organization.name as profile_name, booking.status as booking_status, booking.ends_at as booking_ends_at
       from scout_alert_watches watch
       inner join organizations organization on organization.id = watch.organization_id
       left join bookings booking on booking.id = watch.booking_id
       where watch.id = $1 and watch.worker_id = $2 and watch.status = 'active'`,
      [claim.watchId, claim.workerId],
    );
    const linkedRow = linked.rows[0];
    if (!linkedRow) return null;

    const run = await this.leadScoutRepository.getRun({
      actorId: claim.actorId,
      runId: claim.runId,
    });
    const candidate = run?.candidates.find((item) => item.id === claim.candidateId) ?? null;
    if (!run?.criteria || !candidate) return null;

    return {
      claim,
      profileName: String(linkedRow.profile_name),
      bookingStatus: linkedRow.booking_status ?? null,
      bookingEndsAt: dateOnly(linkedRow.booking_ends_at),
      criteria: run.criteria,
      candidate,
      knownSources: run.sources.slice(0, 32).map((source) => ({
        url: source.url,
        title: source.title,
        publisher: source.publisher,
        category: source.category,
        retrievedAt: source.retrievedAt,
      })),
    };
  }

  async saveSuccess(input: {
    claim: ScoutAlertWatchClaim;
    snapshot: ScoutAlertSnapshot;
    alerts: ScoutAlertDraft[];
    now: Date;
    nextEvaluationAt: Date;
    nextResearchAt: Date;
    researched: boolean;
  }): Promise<void> {
    await this.db.query(
      `with updated as (
         update scout_alert_watches watch
         set snapshot = $4::jsonb,
             next_evaluation_at = $5,
             next_research_at = $6,
             last_evaluated_at = $3,
             last_researched_at = case when $8 then $3 else watch.last_researched_at end,
             last_error = null,
             failure_count = 0,
             worker_id = null,
             lease_expires_at = null,
             updated_at = $3
         where watch.id = $1 and watch.worker_id = $2 and watch.status = 'active'
         returning watch.id, watch.organization_id, watch.booking_id
       ), resolved_monitoring as (
         update scout_alerts alert
         set status = 'resolved', snoozed_until = null, updated_at = $3
         from updated
         where alert.watch_id = updated.id
           and alert.kind = 'monitoring_problem'
           and alert.status in ('open','snoozed')
         returning alert.id
       )
       insert into scout_alerts (
         watch_id, organization_id, booking_id, kind, severity, title, body,
         before_value, after_value, sources, confidence, fingerprint,
         status, due_at, detected_at, created_at, updated_at
       )
       select updated.id, updated.organization_id, updated.booking_id,
         item.kind, item.severity, item.title, item.body,
         item.before_value, item.after_value, coalesce(item.sources, '[]'::jsonb),
         item.confidence, item.fingerprint, 'open', item.due_at, $3, $3, $3
       from updated
       cross join jsonb_to_recordset($7::jsonb) as item(
         kind text, severity text, title text, body text,
         before_value jsonb, after_value jsonb, sources jsonb,
         confidence text, fingerprint text, due_at timestamptz
       )
       on conflict (fingerprint) do nothing`,
      [
        input.claim.watchId,
        input.claim.workerId,
        input.now.toISOString(),
        JSON.stringify(input.snapshot),
        input.nextEvaluationAt.toISOString(),
        input.nextResearchAt.toISOString(),
        JSON.stringify(alertPayload(input.alerts)),
        input.researched,
      ],
    );
  }

  async recordFailure(input: {
    claim: ScoutAlertWatchClaim;
    profileName: string;
    now: Date;
    safeError: string;
    nextRetryAt: Date;
    failureAlert: ScoutAlertDraft | null;
  }): Promise<void> {
    await this.db.query(
      `with updated as (
         update scout_alert_watches watch
         set failure_count = watch.failure_count + 1,
             last_error = $4,
             next_evaluation_at = $5,
             next_research_at = $5,
             worker_id = null,
             lease_expires_at = null,
             updated_at = $3
         where watch.id = $1 and watch.worker_id = $2 and watch.status = 'active'
         returning watch.id, watch.organization_id, watch.booking_id
       )
       insert into scout_alerts (
         watch_id, organization_id, booking_id, kind, severity, title, body,
         before_value, after_value, sources, confidence, fingerprint,
         status, due_at, detected_at, created_at, updated_at
       )
       select updated.id, updated.organization_id, updated.booking_id,
         item.kind, item.severity, item.title, item.body,
         item.before_value, item.after_value, coalesce(item.sources, '[]'::jsonb),
         item.confidence, item.fingerprint, 'open', item.due_at, $3, $3, $3
       from updated
       cross join jsonb_to_recordset($6::jsonb) as item(
         kind text, severity text, title text, body text,
         before_value jsonb, after_value jsonb, sources jsonb,
         confidence text, fingerprint text, due_at timestamptz
       )
       on conflict (fingerprint) do nothing`,
      [
        input.claim.watchId,
        input.claim.workerId,
        input.now.toISOString(),
        input.safeError.replace(/\s+/g, " ").trim().slice(0, 500),
        input.nextRetryAt.toISOString(),
        JSON.stringify(alertPayload(input.failureAlert ? [input.failureAlert] : [])),
      ],
    );
  }

  async completeWatch(input: { claim: ScoutAlertWatchClaim; now: Date }): Promise<void> {
    await this.db.query(
      `with completed as (
         update scout_alert_watches watch
         set status = 'complete', worker_id = null, lease_expires_at = null, updated_at = $3
         where watch.id = $1 and watch.worker_id = $2
         returning watch.id
       )
       update scout_alerts alert
       set status = 'resolved', snoozed_until = null, updated_at = $3
       from completed
       where alert.watch_id = completed.id and alert.status in ('open','snoozed')`,
      [input.claim.watchId, input.claim.workerId, input.now.toISOString()],
    );
  }

  async listVisible(now: Date): Promise<ScoutAlertView[]> {
    const result = await this.db.query(
      `select alert.*, organization.name as profile_name
       from scout_alerts alert
       inner join organizations organization on organization.id = alert.organization_id
       where alert.status = 'open'
          or (alert.status = 'snoozed' and alert.snoozed_until <= $1)
       order by
         case alert.severity when 'urgent' then 0 when 'attention' then 1 else 2 end,
         alert.due_at nulls last,
         alert.detected_at desc,
         alert.id
       limit 50`,
      [now.toISOString()],
    );
    return result.rows.map(alertView);
  }

  async snooze(alertId: string, until: Date): Promise<boolean> {
    const result = await this.db.query(
      `update scout_alerts
       set status = 'snoozed', snoozed_until = $2, updated_at = now()
       where id = $1 and status in ('open','snoozed')
       returning id`,
      [alertId, until.toISOString()],
    );
    return result.rows.length > 0;
  }

  async dismiss(alertId: string): Promise<boolean> {
    const result = await this.db.query(
      `update scout_alerts
       set status = 'dismissed', snoozed_until = null, updated_at = now()
       where id = $1 and status in ('open','snoozed')
       returning id`,
      [alertId],
    );
    return result.rows.length > 0;
  }
}
