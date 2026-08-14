import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  normalizeMatchingEmail,
  normalizeMatchingText,
} from "@/features/act-migration/matching-normalization";
import { calculateBackoffMs } from "./retry-policy";
import { lockProfileLinkTransaction } from "@/features/act-migration/profile-link-transaction-lock";
import { resolveArchiveProfile } from "./archive-profile-resolver";
import type {
  ArchiveProfileBatchCommit,
  ArchiveProfileImportStatus,
  ArchiveProfileResolution,
  ArchiveProfileSource,
  ArchiveProfileSourceContext,
  ProfileCandidate,
  ArchiveProfileResolutionProvenance,
} from "./archive-profile-import-types";
import { normalizeCompany } from "./normalizers/company-normalizer";
import { normalizeContact } from "./normalizers/contact-normalizer";

export type ClaimedArchiveProfileJob = {
  jobId: string;
  runId: string;
  sourceDatabaseKey: string;
  phase: "companies" | "contacts";
  cursorSourceRecordId: string | null;
  leaseToken: string;
};

export interface ArchiveProfileImportStore {
  createOrGetJob(input: {
    runId: string;
    sourceDatabaseKey: string;
    requestKey: string;
    requestedBy: string;
    now: Date;
  }): Promise<ArchiveProfileImportStatus>;
  getStatus(input: {
    runId: string;
    sourceDatabaseKey: string;
    requestedBy: string;
  }): Promise<ArchiveProfileImportStatus | null>;
  claimNext(input: {
    workerId: string;
    now: Date;
  }): Promise<ClaimedArchiveProfileJob | null>;
  loadBatch(
    input: ClaimedArchiveProfileJob & { limit: 50 },
  ): Promise<readonly ArchiveProfileSourceContext[]>;
  commitBatch(
    input: ClaimedArchiveProfileJob & {
      records: readonly {
        source: ArchiveProfileSource;
        resolution: ArchiveProfileResolution;
      }[];
      now: Date;
    },
  ): Promise<ArchiveProfileBatchCommit>;
  failBatch(
    input: ClaimedArchiveProfileJob & {
      errorCode: string;
      retryable: boolean;
      now: Date;
    },
  ): Promise<void>;
}

type DrizzleDatabase = typeof database;
type SqlExecutor = Pick<DrizzleDatabase, "execute">;
type Row = Record<string, unknown>;
type ActivePhase = ClaimedArchiveProfileJob["phase"];
type EntityType = "organization" | "contact";
type ResultStatus =
  | "created"
  | "linked"
  | "updated"
  | "already_imported"
  | "preserved"
  | "retryable_failed";

type ActionableResolution = Extract<ArchiveProfileResolution, {
  action: "create_profile" | "link_existing" | "update_existing";
}>;

function isActionableResolution(
  resolution: ArchiveProfileResolution,
): resolution is ActionableResolution {
  return resolution.action === "create_profile"
    || resolution.action === "link_existing"
    || resolution.action === "update_existing";
}

type LockedJob = {
  id: string;
  runId: string;
  sourceDatabaseKey: string;
  requestedBy: string;
  phase: ActivePhase;
  cursorSourceRecordId: string | null;
  leaseToken: string;
  leaseExpiresAt: Date;
};

type AppliedResolution = {
  status: ResultStatus;
  targetEntityType: EntityType | null;
  targetEntityId: string | null;
  reasonCode: string | null;
  retryAfter: Date | null;
  attemptCount: number;
  evidenceLabels: string[];
  provenance?: ArchiveProfileResolutionProvenance;
};

const MAX_BATCH_SIZE = 50;
const RESOLUTION_POLICY_VERSION = "archive-profile-resolution-v1";
const supportedColumns = {
  organization: {
    name: "name",
    phone: "phone",
    website: "website",
    industry: "act_industry",
    address1: "address_1",
    address2: "address_2",
    city: "city",
    region: "region",
    postalCode: "postal_code",
  },
  contact: {
    firstName: "first_name",
    lastName: "last_name",
    email: "email",
    phone: "phone",
    jobTitle: "job_title",
    address1: "address_1",
    address2: "address_2",
    city: "city",
    region: "region",
    postalCode: "postal_code",
  },
} as const;

const counterColumn: Record<ResultStatus, string> = {
  created: "created_count",
  linked: "linked_count",
  updated: "updated_count",
  already_imported: "already_imported_count",
  preserved: "preserved_count",
  retryable_failed: "retryable_failure_count",
};

function resultRows(value: unknown): Row[] {
  if (Array.isArray(value)) return value as Row[];
  const rows = (value as { rows?: unknown })?.rows;
  return Array.isArray(rows) ? rows as Row[] : [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function nullableString(value: unknown): string | null {
  return value == null ? null : stringValue(value);
}

function dateValue(value: unknown): Date {
  return value instanceof Date ? value : new Date(stringValue(value));
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function repositoryError(code: string, status = 409): Error & { code: string; status: number } {
  return Object.assign(new Error(code), { code, status });
}

function activePhase(value: unknown): ActivePhase | null {
  return value === "companies" || value === "contacts" ? value : null;
}

function streamType(phase: ActivePhase): ArchiveProfileSource["streamType"] {
  return phase === "companies" ? "company" : "contact";
}

function entityTypeFor(source: ArchiveProfileSource): EntityType {
  return source.streamType === "company" ? "organization" : "contact";
}

function safeErrorCode(value: string): string {
  return /^[a-z0-9_]{1,64}$/.test(value) ? value : "archive_profile_batch_failed";
}

function safeEvidenceLabels(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => /^[a-z0-9_:-]{1,64}$/.test(value)))]
    .sort()
    .slice(0, 20);
}

function safePolicyVersion(value: string | undefined): string {
  return value && /^[a-z0-9_:-]{1,64}$/.test(value) ? value : RESOLUTION_POLICY_VERSION;
}

function safeAiProvider(value: string | null | undefined): string | null {
  return value && /^[a-z0-9_:-]{1,64}$/.test(value) ? value : null;
}

function normalizedPhone(value: string | null): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length >= 7 ? digits : null;
}

function sourceValues(source: ArchiveProfileSource): Record<string, unknown> {
  const result = source.streamType === "company"
    ? normalizeCompany(source.rawSnapshot)
    : normalizeContact(source.rawSnapshot);
  return result.ok ? result.value : result.partial;
}

function candidateValues(entityType: EntityType, row: Row): Record<string, string | null> {
  const columns = supportedColumns[entityType];
  return Object.fromEntries(
    Object.entries(columns).map(([logical, physical]) => [logical, nullableString(row[physical])]),
  );
}

function statusFromRow(row: Row): ArchiveProfileImportStatus {
  const phase = stringValue(row.phase);
  return {
    jobId: stringValue(row.jobId ?? row.id),
    runId: stringValue(row.runId),
    phase: phase === "companies" || phase === "contacts" || phase === "complete" || phase === "failed"
      ? phase
      : "failed",
    active: phase === "companies" || phase === "contacts",
    eligibleCount: Number(row.eligibleCount ?? 0),
    processedCount: Number(row.processedCount ?? 0),
    createdCount: Number(row.createdCount ?? 0),
    linkedCount: Number(row.linkedCount ?? 0),
    updatedCount: Number(row.updatedCount ?? 0),
    alreadyImportedCount: Number(row.alreadyImportedCount ?? 0),
    preservedCount: Number(row.preservedCount ?? 0),
    retryableFailureCount: Number(row.retryableFailureCount ?? 0),
    lastErrorCode: nullableString(row.lastErrorCode),
  };
}

function statusSelection() {
  return sql`jobs.id as "jobId", jobs.run_id as "runId", jobs.phase,
    jobs.eligible_count as "eligibleCount", jobs.processed_count as "processedCount",
    jobs.created_count as "createdCount", jobs.linked_count as "linkedCount",
    jobs.updated_count as "updatedCount",
    jobs.already_imported_count as "alreadyImportedCount",
    jobs.preserved_count as "preservedCount",
    jobs.retryable_failure_count as "retryableFailureCount",
    jobs.last_error_code as "lastErrorCode"`;
}

export class DrizzleArchiveProfileImportRepository implements ArchiveProfileImportStore {
  constructor(private readonly database: DrizzleDatabase) {}

  private async query(
    query: ReturnType<typeof sql>,
    executor: SqlExecutor = this.database,
  ): Promise<Row[]> {
    return resultRows(await executor.execute(query));
  }

  async createOrGetJob(input: {
    runId: string;
    sourceDatabaseKey: string;
    requestKey: string;
    requestedBy: string;
    now: Date;
  }): Promise<ArchiveProfileImportStatus> {
    if (!input.requestKey.trim()) throw repositoryError("request_key_required", 400);
    if (!input.requestedBy.trim()) throw repositoryError("requested_by_required", 400);
    return this.database.transaction(async (transaction) => {
      const executor = transaction as unknown as SqlExecutor;
      const owned = await this.query(sql`
        select id from act_replacement_runs
        where id = ${input.runId}
          and source_database_key = ${input.sourceDatabaseKey}
          and requested_by = ${input.requestedBy}
        limit 1
      `, executor);
      if (owned.length !== 1) throw repositoryError("archive_profile_run_not_found", 404);

      const inserted = await this.query(sql`
        insert into act_archive_profile_import_jobs
          (run_id, source_database_key, request_key, requested_by,
           eligible_count, membership_snapshot_version, created_at, updated_at)
        values (${input.runId}, ${input.sourceDatabaseKey}, ${input.requestKey},
          ${input.requestedBy}, 0, 2, ${input.now}, ${input.now})
        on conflict (run_id) do nothing
        returning id
      `, executor);
      if (inserted[0]) {
        const jobId = stringValue(inserted[0].id);
        await executor.execute(sql`
          insert into act_archive_profile_import_sources
            (job_id, source_database_key, source_record_id, source_version_id, phase)
          select ${jobId}, source.source_database_key, source.id, source.latest_version_id,
            case source.stream_type when 'company' then 'companies' else 'contacts' end
          from act_source_records source
          where source.source_database_key = ${input.sourceDatabaseKey}
            and source.stream_type in ('company', 'contact')
            and source.latest_version_id is not null
          order by source.id
        `);
        await executor.execute(sql`
          update act_archive_profile_import_jobs jobs
          set eligible_count = (
            select count(*) from act_archive_profile_import_sources membership
            where membership.job_id = jobs.id
          )
          where jobs.id = ${jobId}
        `);
      }
      const locked = await this.query(sql`
        select id, phase, membership_snapshot_version as "membershipSnapshotVersion",
          (lease_token is not null and lease_expires_at > clock_timestamp()) as "hasLiveLease"
        from act_archive_profile_import_jobs
        where run_id = ${input.runId}
          and source_database_key = ${input.sourceDatabaseKey}
          and requested_by = ${input.requestedBy}
        for update
      `, executor);
      const job = locked[0];
      if (!job) throw repositoryError("archive_profile_job_not_found", 404);
      if (
        job.phase === "failed" &&
        job.hasLiveLease !== true &&
        Number(job.membershipSnapshotVersion) === 2
      ) {
        const remaining = await this.query(sql`
          select membership.phase
          from act_archive_profile_import_sources membership
          left join act_archive_profile_import_results results
            on results.job_id = membership.job_id
            and results.source_record_id = membership.source_record_id
          where membership.job_id = ${stringValue(job.id)}
            and (results.id is null or results.status = 'retryable_failed')
          order by case membership.phase when 'companies' then 0 else 1 end,
            membership.source_record_id
          limit 1
        `, executor);
        const resumePhase = remaining[0]?.phase === "contacts"
          ? "contacts"
          : remaining[0]?.phase === "companies"
            ? "companies"
            : "complete";
        await executor.execute(sql`
          update act_archive_profile_import_jobs
          set phase = ${resumePhase}, cursor_source_record_id = null,
            retry_after = null, lease_owner = null, lease_token = null,
            lease_expires_at = null, last_error_code = null,
            completed_at = ${resumePhase === "complete" ? input.now : null},
            failure_attempt_count = 0, updated_at = ${input.now}
          where id = ${stringValue(job.id)} and phase = 'failed'
        `);
      }
      const rows = await this.statusRows(sql`
        jobs.run_id = ${input.runId}
          and jobs.source_database_key = ${input.sourceDatabaseKey}
          and jobs.requested_by = ${input.requestedBy}
      `, executor);
      if (!rows[0]) throw repositoryError("archive_profile_job_not_found", 404);
      return statusFromRow(rows[0]);
    });
  }

  async getStatus(input: {
    runId: string;
    sourceDatabaseKey: string;
    requestedBy: string;
  }): Promise<ArchiveProfileImportStatus | null> {
    const rows = await this.statusRows(sql`
      jobs.run_id = ${input.runId}
        and jobs.source_database_key = ${input.sourceDatabaseKey}
        and jobs.requested_by = ${input.requestedBy}
    `);
    return rows[0] ? statusFromRow(rows[0]) : null;
  }

  private statusRows(condition: ReturnType<typeof sql>, executor: SqlExecutor = this.database) {
    return this.query(sql`
      select ${statusSelection()}
      from act_archive_profile_import_jobs jobs
      inner join act_replacement_runs runs
        on runs.id = jobs.run_id
        and runs.source_database_key = jobs.source_database_key
        and runs.requested_by = jobs.requested_by
      where ${condition}
      limit 1
    `, executor);
  }

  async claimNext(input: {
    workerId: string;
    now: Date;
  }): Promise<ClaimedArchiveProfileJob | null> {
    if (!input.workerId.trim()) throw repositoryError("worker_id_required", 400);
    return this.database.transaction(async (transaction) => {
      const executor = transaction as unknown as SqlExecutor;
      const available = await this.query(sql`
        select id
        from act_archive_profile_import_jobs
        where phase in ('companies', 'contacts')
          and membership_snapshot_version = 2
          and (retry_after is null or retry_after <= clock_timestamp())
          and (lease_token is null or lease_expires_at <= clock_timestamp())
        order by updated_at, id
        for update skip locked
        limit 1
      `, executor);
      if (!available[0]) return null;

      const leaseToken = randomUUID();
      const claimed = await this.query(sql`
        update act_archive_profile_import_jobs
        set lease_owner = ${input.workerId}, lease_token = ${leaseToken},
          lease_expires_at = clock_timestamp() + interval '5 minutes', updated_at = clock_timestamp()
        where id = ${stringValue(available[0].id)}
        returning id as "jobId", run_id as "runId",
          source_database_key as "sourceDatabaseKey", phase,
          cursor_source_record_id as "cursorSourceRecordId",
          lease_token as "leaseToken"
      `, executor);
      const row = claimed[0];
      const phase = activePhase(row?.phase);
      if (!row || !phase) throw repositoryError("archive_profile_claim_failed");
      return {
        jobId: stringValue(row.jobId),
        runId: stringValue(row.runId),
        sourceDatabaseKey: stringValue(row.sourceDatabaseKey),
        phase,
        cursorSourceRecordId: nullableString(row.cursorSourceRecordId),
        leaseToken: stringValue(row.leaseToken),
      };
    });
  }

  async loadBatch(
    input: ClaimedArchiveProfileJob & { limit: 50 },
  ): Promise<readonly ArchiveProfileSourceContext[]> {
    if (input.limit !== MAX_BATCH_SIZE) throw repositoryError("archive_profile_batch_limit_invalid", 400);
    const job = await this.loadClaim(input);
    const sourceKind = streamType(job.phase);
    let sourceRows = await this.query(sql`
      select source.id as "sourceRecordId", version.id as "sourceVersionId",
        source.stream_type as "streamType", source.act_record_id as "actRecordId",
        version.raw_snapshot as "rawSnapshot",
        source.relationship_evidence as "relationshipEvidence"
      from act_archive_profile_import_sources membership
      inner join act_source_records source on source.id = membership.source_record_id
      inner join act_source_record_versions version on version.id = membership.source_version_id
      left join act_archive_profile_import_results results
        on results.job_id = membership.job_id and results.source_record_id = membership.source_record_id
      where membership.job_id = ${job.id}
        and membership.phase = ${job.phase}
        and results.id is null
      order by membership.source_record_id
      limit 50
    `);
    if (sourceRows.length === 0) {
      sourceRows = await this.query(sql`
        select source.id as "sourceRecordId", version.id as "sourceVersionId",
          source.stream_type as "streamType", source.act_record_id as "actRecordId",
          version.raw_snapshot as "rawSnapshot",
          source.relationship_evidence as "relationshipEvidence"
        from act_archive_profile_import_results results
        inner join act_source_records source on source.id = results.source_record_id
        inner join act_archive_profile_import_sources membership
          on membership.job_id = results.job_id and membership.source_record_id = results.source_record_id
        inner join act_source_record_versions version on version.id = membership.source_version_id
        where results.job_id = ${job.id}
          and results.status = 'retryable_failed'
          and (results.retry_after is null or results.retry_after <= now())
          and source.source_database_key = ${job.sourceDatabaseKey}
          and source.stream_type = ${sourceKind}
          and membership.phase = ${job.phase}
        order by results.retry_after nulls first, source.id
        limit 50
      `);
    }

    const sources = sourceRows.map((row) => this.source(row));
    if (sources.length === 0) return [];
    if (sourceKind === "contact") await this.addRelationshipContext(sources, job.sourceDatabaseKey);
    const [linked, candidates] = await Promise.all([
      this.linkedTargets(sources, job.sourceDatabaseKey),
      this.exactCandidates(sources),
    ]);
    return sources.map((source) => ({
      source,
      candidates: candidates.get(source.sourceRecordId) ?? [],
      linkedTarget: linked.get(source.sourceRecordId) ?? null,
    }));
  }

  private async loadClaim(input: ClaimedArchiveProfileJob): Promise<LockedJob> {
    const rows = await this.query(sql`
      select id, run_id as "runId", source_database_key as "sourceDatabaseKey",
        requested_by as "requestedBy", phase,
        cursor_source_record_id as "cursorSourceRecordId",
        lease_token as "leaseToken", lease_expires_at as "leaseExpiresAt"
      from act_archive_profile_import_jobs
      where id = ${input.jobId} and run_id = ${input.runId}
        and source_database_key = ${input.sourceDatabaseKey}
        and phase = ${input.phase} and lease_token = ${input.leaseToken}
        and cursor_source_record_id is not distinct from ${input.cursorSourceRecordId}::uuid
        and lease_expires_at > clock_timestamp()
      limit 1
    `);
    if (!rows[0]) throw repositoryError("archive_profile_lease_lost");
    return this.lockedJob(rows[0]);
  }

  private lockedJob(row: Row): LockedJob {
    const phase = activePhase(row.phase);
    if (!phase) throw repositoryError("archive_profile_lease_lost");
    return {
      id: stringValue(row.id),
      runId: stringValue(row.runId),
      sourceDatabaseKey: stringValue(row.sourceDatabaseKey),
      requestedBy: stringValue(row.requestedBy),
      phase,
      cursorSourceRecordId: nullableString(row.cursorSourceRecordId),
      leaseToken: stringValue(row.leaseToken),
      leaseExpiresAt: dateValue(row.leaseExpiresAt),
    };
  }

  private source(row: Row): ArchiveProfileSource {
    const kind = row.streamType;
    if (kind !== "company" && kind !== "contact") {
      throw repositoryError("archive_profile_source_type_invalid");
    }
    return {
      sourceRecordId: stringValue(row.sourceRecordId),
      sourceVersionId: stringValue(row.sourceVersionId),
      streamType: kind,
      actRecordId: nullableString(row.actRecordId),
      rawSnapshot: jsonObject(row.rawSnapshot),
      relationshipEvidence: jsonObject(row.relationshipEvidence),
    };
  }

  private async addRelationshipContext(
    sources: ArchiveProfileSource[],
    sourceDatabaseKey: string,
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    const evidenceBudget = MAX_BATCH_SIZE - sources.length;
    if (evidenceBudget <= 0) return;
    const contactIds = sources.map((source) => source.actRecordId).filter((value): value is string => Boolean(value));
    if (contactIds.length === 0) return;
    const relationships = await this.query(sql`
      select relationship_evidence as evidence, count(*) over() as "totalCount"
      from act_source_records
      where source_database_key = ${sourceDatabaseKey}
        and stream_type = 'company_contact'
        and latest_version_id is not null
        and (
          relationship_evidence->>'parentActRecordId' in (${sql.join(contactIds.map((id) => sql`${id}`), sql`, `)})
          or relationship_evidence->>'targetActRecordId' in (${sql.join(contactIds.map((id) => sql`${id}`), sql`, `)})
        )
      order by id
      limit ${evidenceBudget}
    `, executor);
    if (Number(relationships[0]?.totalCount ?? 0) > evidenceBudget) return;
    for (const source of sources) {
      const companyIds = new Set(this.companyActRecordIds(source.relationshipEvidence, source.actRecordId));
      for (const row of relationships) {
        const evidence = jsonObject(row.evidence);
        for (const id of this.companyActRecordIds(evidence, source.actRecordId)) companyIds.add(id);
      }
      if (companyIds.size > 0) {
        source.relationshipEvidence = {
          ...source.relationshipEvidence,
          companyActRecordIds: [...companyIds].sort(),
          relationshipEvidenceComplete: true,
        };
      }
    }
  }

  private companyActRecordIds(evidence: Record<string, unknown>, contactActRecordId: string | null): string[] {
    const result = new Set<string>();
    for (const key of ["companyActRecordId", "parentCompanyActRecordId", "organizationActRecordId"]) {
      if (typeof evidence[key] === "string" && String(evidence[key]).trim()) result.add(String(evidence[key]));
    }
    if (Array.isArray(evidence.companyActRecordIds)) {
      for (const value of evidence.companyActRecordIds) {
        if (typeof value === "string" && value.trim()) result.add(value);
      }
    }
    if (evidence.parentKind === "company" && typeof evidence.parentActRecordId === "string"
      && (contactActRecordId === null || evidence.targetActRecordId === contactActRecordId)) {
      result.add(evidence.parentActRecordId);
    }
    if (evidence.targetKind === "company" && typeof evidence.targetActRecordId === "string"
      && (contactActRecordId === null || evidence.parentActRecordId === contactActRecordId)) {
      result.add(evidence.targetActRecordId);
    }
    return [...result];
  }

  private async linkedTargets(
    sources: readonly ArchiveProfileSource[],
    sourceDatabaseKey: string,
    executor: SqlExecutor = this.database,
  ): Promise<Map<string, ProfileCandidate>> {
    const sourceIds = sources.map((source) => source.sourceRecordId);
    const actIds = sources.map((source) => source.actRecordId).filter((value): value is string => Boolean(value));
    const sourceKind = sources[0]!.streamType;
    const scopedCondition = actIds.length > 0
      ? sql`or (links.source_database_key = ${sourceDatabaseKey}
          and links.source_entity_type = ${sourceKind}
          and links.act_record_id in (${sql.join(actIds.map((id) => sql`${id}`), sql`, `)}))`
      : sql``;
    const rows = await this.query(sql`
      select links.source_record_id as "linkedSourceRecordId", links.act_record_id as "actRecordId",
        links.entity_type as "entityType", links.entity_id as id,
        organizations.name, organizations.phone, organizations.website,
        organizations.act_industry, organizations.address_1, organizations.address_2,
        organizations.city, organizations.region, organizations.postal_code,
        contacts.first_name, contacts.last_name, contacts.email,
        contacts.phone as contact_phone, contacts.job_title,
        contacts.address_1 as contact_address_1, contacts.address_2 as contact_address_2,
        contacts.city as contact_city, contacts.region as contact_region,
        contacts.postal_code as contact_postal_code
      from act_external_links links
      left join organizations on links.entity_type = 'organization' and organizations.id = links.entity_id
      left join contacts on links.entity_type = 'contact' and contacts.id = links.entity_id
      where links.source_record_id in (${sql.join(sourceIds.map((id) => sql`${id}`), sql`, `)})
        ${scopedCondition}
      order by links.id
    `, executor);
    const bySource = new Map<string, ProfileCandidate>();
    for (const row of rows) {
      const type = row.entityType;
      if (type !== "organization" && type !== "contact") continue;
      const source = sources.find((candidate) =>
        candidate.sourceRecordId === nullableString(row.linkedSourceRecordId)
        || (candidate.actRecordId !== null && candidate.actRecordId === nullableString(row.actRecordId)),
      );
      if (!source || entityTypeFor(source) !== type) continue;
      const normalizedRow = type === "contact"
        ? {
            ...row,
            phone: row.contact_phone,
            address_1: row.contact_address_1,
            address_2: row.contact_address_2,
            city: row.contact_city,
            region: row.contact_region,
            postal_code: row.contact_postal_code,
          }
        : row;
      const values = candidateValues(type, normalizedRow);
      const requiredPresent = type === "organization"
        ? values.name !== null
        : values.firstName !== null && values.lastName !== null;
      if (!requiredPresent) continue;
      bySource.set(source.sourceRecordId, {
        id: stringValue(row.id),
        entityType: type,
        exactSignals: ["source_link"],
        values,
      });
    }
    return bySource;
  }

  private exactCandidates(
    sources: readonly ArchiveProfileSource[],
    executor: SqlExecutor = this.database,
  ): Promise<Map<string, ProfileCandidate[]>> {
    return sources[0]!.streamType === "company"
      ? this.companyCandidates(sources, executor)
      : this.contactCandidates(sources, executor);
  }

  private async companyCandidates(
    sources: readonly ArchiveProfileSource[],
    executor: SqlExecutor = this.database,
  ): Promise<Map<string, ProfileCandidate[]>> {
    const wanted = sources.flatMap((source) => {
      const values = sourceValues(source);
      const name = normalizeMatchingText(typeof values.name === "string" ? values.name : null);
      if (!name) return [];
      const city = normalizeMatchingText(typeof values.city === "string" ? values.city : null);
      const region = normalizeMatchingText(typeof values.region === "string" ? values.region : null);
      return [{ sourceRecordId: source.sourceRecordId, name, city, region, hasLocation: city !== null || region !== null }];
    });
    if (wanted.length === 0) return new Map();
    const rows = await this.query(sql`
      with wanted("sourceRecordId", name, city, region, "hasLocation") as (
        values ${sql.join(wanted.map((item) => sql`(
          ${item.sourceRecordId}::uuid, ${item.name}::text, ${item.city}::text,
          ${item.region}::text, ${item.hasLocation}::boolean
        )`), sql`, `)}
      )
      select wanted."sourceRecordId", target.*
      from wanted
      cross join lateral (
        select organizations.*
        from organizations
        where lower(regexp_replace(btrim(organizations.name), '\\s+', ' ', 'g')) = wanted.name
          and (not wanted."hasLocation" or (
            nullif(lower(regexp_replace(btrim(coalesce(organizations.city, '')), '\\s+', ' ', 'g')), '')
              is not distinct from wanted.city
            and nullif(lower(regexp_replace(btrim(coalesce(organizations.region, '')), '\\s+', ' ', 'g')), '')
              is not distinct from wanted.region
          ))
        order by organizations.id
        limit 2
      ) target
      order by wanted."sourceRecordId", target.id
    `, executor);
    const result = new Map<string, ProfileCandidate[]>();
    for (const row of rows) {
      const sourceRecordId = stringValue(row.sourceRecordId);
      const candidates = result.get(sourceRecordId) ?? [];
      candidates.push({
        id: stringValue(row.id),
        entityType: "organization",
        exactSignals: ["company_name_and_location"],
        values: candidateValues("organization", row),
      });
      result.set(sourceRecordId, candidates);
    }
    return result;
  }

  private async contactCandidates(
    sources: readonly ArchiveProfileSource[],
    executor: SqlExecutor = this.database,
  ): Promise<Map<string, ProfileCandidate[]>> {
    const wanted = sources.flatMap((source) => {
      const values = sourceValues(source);
      const email = values.emailIdentityMatchSafe === true
        ? normalizeMatchingEmail(typeof values.email === "string" ? values.email : null)
        : null;
      const phone = normalizedPhone(typeof values.phone === "string" ? values.phone : null);
      const firstName = normalizeMatchingText(typeof values.firstName === "string" ? values.firstName : null);
      const lastName = normalizeMatchingText(typeof values.lastName === "string" ? values.lastName : null);
      if (!email && !(phone && firstName && lastName)) return [];
      return [{ sourceRecordId: source.sourceRecordId, email, phone, firstName, lastName }];
    });
    if (wanted.length === 0) return new Map();
    const rows = await this.query(sql`
      with wanted("sourceRecordId", email, phone, "firstName", "lastName") as (
        values ${sql.join(wanted.map((item) => sql`(
          ${item.sourceRecordId}::uuid, ${item.email}::text, ${item.phone}::text,
          ${item.firstName}::text, ${item.lastName}::text
        )`), sql`, `)}
      )
      select wanted."sourceRecordId",
        (wanted.email is not null and lower(btrim(target.email)) = wanted.email) as "emailMatch",
        (wanted.phone is not null
          and regexp_replace(coalesce(target.phone, ''), '\\D', '', 'g') = wanted.phone
          and lower(regexp_replace(btrim(target.first_name), '\\s+', ' ', 'g')) = wanted."firstName"
          and lower(regexp_replace(btrim(target.last_name), '\\s+', ' ', 'g')) = wanted."lastName") as "phoneNameMatch",
        target.*
      from wanted
      cross join lateral (
        select contacts.*
        from contacts
        where ((wanted.email is not null and lower(btrim(contacts.email)) = wanted.email)
          or (wanted.phone is not null
            and regexp_replace(coalesce(contacts.phone, ''), '\\D', '', 'g') = wanted.phone
            and lower(regexp_replace(btrim(contacts.first_name), '\\s+', ' ', 'g')) = wanted."firstName"
            and lower(regexp_replace(btrim(contacts.last_name), '\\s+', ' ', 'g')) = wanted."lastName"))
        order by contacts.id
        limit 2
      ) target
      order by wanted."sourceRecordId", target.id
    `, executor);
    const result = new Map<string, ProfileCandidate[]>();
    for (const row of rows) {
      const sourceRecordId = stringValue(row.sourceRecordId);
      const exactSignals: ProfileCandidate["exactSignals"] = [];
      if (row.emailMatch === true) exactSignals.push("email");
      if (row.phoneNameMatch === true) exactSignals.push("phone_and_name");
      const candidates = result.get(sourceRecordId) ?? [];
      candidates.push({
        id: stringValue(row.id),
        entityType: "contact",
        exactSignals,
        values: candidateValues("contact", row),
      });
      result.set(sourceRecordId, candidates);
    }
    return result;
  }

  async commitBatch(
    input: ClaimedArchiveProfileJob & {
      records: readonly { source: ArchiveProfileSource; resolution: ArchiveProfileResolution }[];
      now: Date;
    },
  ): Promise<ArchiveProfileBatchCommit> {
    if (input.records.length > MAX_BATCH_SIZE) throw repositoryError("archive_profile_batch_too_large", 400);
    const ids = input.records.map((record) => record.source.sourceRecordId);
    if (new Set(ids).size !== ids.length) throw repositoryError("archive_profile_batch_source_duplicate", 400);
    return this.database.transaction(async (transaction) => {
      const executor = transaction as unknown as SqlExecutor;
      await lockProfileLinkTransaction(executor);
      const job = await this.lockClaim(input, input.now, executor);
      const expectedSources = await this.lockExpectedBatch(job, executor);
      const expectedKeys = expectedSources.map((source) =>
        `${source.sourceRecordId}:${source.sourceVersionId}`
      );
      const suppliedKeys = input.records.map(({ source }) =>
        `${source.sourceRecordId}:${source.sourceVersionId}`
      );
      if (expectedKeys.length !== suppliedKeys.length
        || expectedKeys.some((key, index) => key !== suppliedKeys[index])) {
        throw repositoryError("archive_profile_batch_mismatch", 409);
      }
      if (job.phase === "contacts" && expectedSources.length > 0) {
        await this.addRelationshipContext(expectedSources, job.sourceDatabaseKey, executor);
      }
      // Lock classes are job -> all sources -> targets -> links. Target/link
      // order matches entity apply; table locks make exact cardinality
      // rechecks phantom-safe for this bounded one-time import.
      await executor.execute(sql`
        lock table organizations, contacts in exclusive mode
      `);
      const prelockedTargets = await this.prelockTargets(
        expectedSources, input.records, job.sourceDatabaseKey, executor,
      );
      // EXCLUSIVE conflicts with SELECT ... FOR UPDATE's ROW SHARE table lock,
      // so entity apply cannot hold a link row while waiting to mutate it.
      await executor.execute(sql`lock table act_external_links in exclusive mode`);
      await this.assertLinkTargetsPrelocked(
        expectedSources, job.sourceDatabaseKey, prelockedTargets, executor,
      );
      const records = input.records.map((record, index) => ({
        ...record,
        source: expectedSources[index]!,
      }));
      const deltas = new Map<string, number>();
      let processedDelta = 0;
      let cursor = job.cursorSourceRecordId;

      for (const record of records) {
        const source = { source: record.source, isNew: true };
        if (cursor === null || source.source.sourceRecordId.localeCompare(cursor) > 0) {
          cursor = source.source.sourceRecordId;
        }
        const previousRows = await this.query(sql`
          select status, attempt_count as "attemptCount"
          from act_archive_profile_import_results
          where job_id = ${job.id} and source_record_id = ${source.source.sourceRecordId}
          for update
        `, executor);
        const previousStatus = previousRows[0]?.status as ResultStatus | undefined;
        const previousAttemptCount = Number(previousRows[0]?.attemptCount ?? 0);
        const existingLink = await this.lockSourceLink(source.source, job.sourceDatabaseKey, executor);
        if (record.resolution.action === "already_imported"
          && (!existingLink
            || existingLink.entityType !== record.resolution.targetEntityType
            || stringValue(existingLink.entityId) !== record.resolution.targetEntityId)) {
          throw repositoryError("profile_source_link_stale");
        }
        const applied = existingLink
          ? await this.alreadyImported(existingLink, source.source, previousAttemptCount, executor)
          : await this.applyResolution(job, source.source, record.resolution, previousAttemptCount, executor);

        await executor.execute(sql`
          insert into act_archive_profile_import_results
            (job_id, source_record_id, source_version_id, status,
             target_entity_type, target_entity_id, reason_code,
             resolution_policy_version, ai_provider, ai_confidence,
             evidence_labels, attempt_count,
             retry_after, created_at, updated_at)
          values (${job.id}, ${source.source.sourceRecordId}, ${source.source.sourceVersionId},
            ${applied.status}, ${applied.targetEntityType}, ${applied.targetEntityId},
            ${applied.reasonCode},
            ${safePolicyVersion(applied.provenance?.resolutionPolicyVersion)},
            ${safeAiProvider(applied.provenance?.aiProvider)},
            ${applied.provenance?.aiConfidence ?? null},
            ${JSON.stringify(safeEvidenceLabels(applied.evidenceLabels))}::jsonb,
            ${applied.attemptCount}, ${applied.retryAfter}, ${input.now}, ${input.now})
          on conflict (job_id, source_record_id) do update
          set source_version_id = excluded.source_version_id,
            status = excluded.status,
            target_entity_type = excluded.target_entity_type,
            target_entity_id = excluded.target_entity_id,
            reason_code = excluded.reason_code,
            resolution_policy_version = excluded.resolution_policy_version,
            ai_provider = excluded.ai_provider,
            ai_confidence = excluded.ai_confidence,
            evidence_labels = excluded.evidence_labels,
            attempt_count = excluded.attempt_count,
            retry_after = excluded.retry_after,
            updated_at = excluded.updated_at
        `);
        if (!previousStatus) processedDelta += 1;
        if (previousStatus !== applied.status) {
          if (previousStatus) deltas.set(counterColumn[previousStatus], (deltas.get(counterColumn[previousStatus]) ?? 0) - 1);
          deltas.set(counterColumn[applied.status], (deltas.get(counterColumn[applied.status]) ?? 0) + 1);
        }
      }

      const next = await this.nextState(job, cursor, executor);
      const assignments = [
        sql`processed_count = processed_count + ${processedDelta}`,
        ...[...deltas.entries()].map(([column, delta]) => sql`${sql.raw(column)} = ${sql.raw(column)} + ${delta}`),
        sql`phase = ${next.phase}`,
        sql`cursor_source_record_id = ${next.cursorSourceRecordId}::uuid`,
        sql`retry_after = ${next.retryAfter}`,
        sql`failure_attempt_count = 0`,
        sql`last_error_code = ${next.lastErrorCode}`,
        sql`completed_at = ${next.phase === "complete" ? input.now : null}`,
        sql`lease_owner = null`,
        sql`lease_token = null`,
        sql`lease_expires_at = null`,
        sql`updated_at = ${input.now}`,
      ];
      const fenced = await this.query(sql`
        update act_archive_profile_import_jobs
        set ${sql.join(assignments, sql`, `)}
        where id = ${job.id} and lease_token = ${job.leaseToken}
          and lease_expires_at > clock_timestamp()
        returning id
      `, executor);
      if (fenced.length !== 1) throw repositoryError("archive_profile_lease_lost");
      const rows = await this.statusRows(sql`jobs.id = ${job.id}`, executor);
      if (!rows[0]) throw repositoryError("archive_profile_job_not_found", 404);
      return {
        status: statusFromRow(rows[0]),
        phaseAdvanced: next.phase !== job.phase,
      };
    });
  }

  private async lockClaim(
    input: ClaimedArchiveProfileJob,
    _now: Date,
    executor: SqlExecutor,
  ): Promise<LockedJob> {
    const rows = await this.query(sql`
      select id, run_id as "runId", source_database_key as "sourceDatabaseKey",
        requested_by as "requestedBy", phase,
        cursor_source_record_id as "cursorSourceRecordId",
        lease_token as "leaseToken", lease_expires_at as "leaseExpiresAt"
      from act_archive_profile_import_jobs
      where id = ${input.jobId} and run_id = ${input.runId}
        and source_database_key = ${input.sourceDatabaseKey}
        and phase = ${input.phase} and lease_token = ${input.leaseToken}
        and cursor_source_record_id is not distinct from ${input.cursorSourceRecordId}::uuid
        and lease_expires_at > clock_timestamp()
      for update
    `, executor);
    if (!rows[0]) throw repositoryError("archive_profile_lease_lost");
    return this.lockedJob(rows[0]);
  }

  private async lockExpectedBatch(
    job: LockedJob,
    executor: SqlExecutor,
  ): Promise<ArchiveProfileSource[]> {
    const newRows = await this.query(sql`
      select source.id as "sourceRecordId", version.id as "sourceVersionId",
        source.stream_type as "streamType", source.act_record_id as "actRecordId",
        version.raw_snapshot as "rawSnapshot",
        source.relationship_evidence as "relationshipEvidence"
      from act_archive_profile_import_sources membership
      join act_source_records source on source.id = membership.source_record_id
      join act_source_record_versions version on version.id = membership.source_version_id
      left join act_archive_profile_import_results results
        on results.job_id = membership.job_id and results.source_record_id = membership.source_record_id
      where membership.job_id = ${job.id}
        and membership.phase = ${job.phase}
        and results.id is null
      order by membership.source_record_id
      limit 50
      for update of source
    `, executor);
    if (newRows.length > 0) return newRows.map((row) => this.source(row));
    const retryRows = await this.query(sql`
      select source.id as "sourceRecordId", version.id as "sourceVersionId",
        source.stream_type as "streamType", source.act_record_id as "actRecordId",
        version.raw_snapshot as "rawSnapshot",
        source.relationship_evidence as "relationshipEvidence"
      from act_archive_profile_import_results results
      join act_archive_profile_import_sources membership
        on membership.job_id = results.job_id and membership.source_record_id = results.source_record_id
      join act_source_records source on source.id = membership.source_record_id
      join act_source_record_versions version on version.id = membership.source_version_id
      where results.job_id = ${job.id}
        and membership.phase = ${job.phase}
        and results.status = 'retryable_failed'
        and (results.retry_after is null or results.retry_after <= now())
      order by results.retry_after nulls first, membership.source_record_id
      limit 50
      for update of source
    `, executor);
    return retryRows.map((row) => this.source(row));
  }

  private async prelockTargets(
    sources: readonly ArchiveProfileSource[],
    supplied: readonly { source: ArchiveProfileSource; resolution: ArchiveProfileResolution }[],
    sourceDatabaseKey: string,
    executor: SqlExecutor,
  ): Promise<Set<string>> {
    if (sources.length === 0) return new Set();
    const [candidateMap, linkedMap, relevantLinks] = await Promise.all([
      this.exactCandidates(sources, executor),
      this.linkedTargets(sources, sourceDatabaseKey, executor),
      this.relevantLinkTargets(sources, sourceDatabaseKey, executor),
    ]);
    const byType: Record<EntityType, Set<string>> = {
      organization: new Set(),
      contact: new Set(),
    };
    for (const candidates of candidateMap.values()) {
      for (const candidate of candidates) byType[candidate.entityType].add(candidate.id);
    }
    for (const candidate of linkedMap.values()) byType[candidate.entityType].add(candidate.id);
    for (const target of relevantLinks) byType[target.entityType].add(target.entityId);
    for (const { resolution } of supplied) {
      if (resolution.action === "link_existing" || resolution.action === "update_existing"
        || resolution.action === "already_imported") {
        byType[resolution.targetEntityType].add(resolution.targetEntityId);
      }
    }
    for (const entityType of ["organization", "contact"] as const) {
      const ids = [...byType[entityType]].sort();
      if (ids.length === 0) continue;
      const table = entityType === "organization" ? "organizations" : "contacts";
      await this.query(sql`
        select id from ${sql.raw(table)}
        where id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
        order by id for update
      `, executor);
    }
    return new Set((Object.entries(byType) as [EntityType, Set<string>][]).flatMap(
      ([entityType, ids]) => [...ids].map((id) => `${entityType}:${id}`),
    ));
  }

  private async relevantLinkTargets(
    sources: readonly ArchiveProfileSource[],
    sourceDatabaseKey: string,
    executor: SqlExecutor,
  ): Promise<{ entityType: EntityType; entityId: string }[]> {
    const sourceIds = sources.map((source) => source.sourceRecordId);
    const sourceActIds = sources.flatMap((source) => source.actRecordId ? [source.actRecordId] : []);
    const parentActIds = sources.flatMap((source) =>
      this.companyActRecordIds(source.relationshipEvidence, source.actRecordId)
    );
    const rows = await this.query(sql`
      select entity_type as "entityType", entity_id as "entityId"
      from act_external_links
      where source_record_id in (${sql.join(sourceIds.map((id) => sql`${id}`), sql`, `)})
        ${sourceActIds.length > 0 ? sql`or (
          source_database_key = ${sourceDatabaseKey}
          and source_entity_type = ${sources[0]!.streamType}
          and act_record_id in (${sql.join(sourceActIds.map((id) => sql`${id}`), sql`, `)})
        )` : sql``}
        ${parentActIds.length > 0 ? sql`or (
          source_database_key = ${sourceDatabaseKey}
          and source_entity_type = 'company'
          and act_record_id in (${sql.join(parentActIds.map((id) => sql`${id}`), sql`, `)})
        )` : sql``}
      order by entity_type, entity_id
    `, executor);
    return rows.flatMap((row) => row.entityType === "organization" || row.entityType === "contact"
      ? [{ entityType: row.entityType, entityId: stringValue(row.entityId) }]
      : []);
  }

  private async assertLinkTargetsPrelocked(
    sources: readonly ArchiveProfileSource[],
    sourceDatabaseKey: string,
    prelocked: ReadonlySet<string>,
    executor: SqlExecutor,
  ): Promise<void> {
    const current = await this.relevantLinkTargets(sources, sourceDatabaseKey, executor);
    if (current.some((target) => !prelocked.has(`${target.entityType}:${target.entityId}`))) {
      throw repositoryError("archive_profile_target_set_changed");
    }
  }

  private async lockSourceLink(
    source: ArchiveProfileSource,
    sourceDatabaseKey: string,
    executor: SqlExecutor,
  ): Promise<Row | null> {
    const actCondition = source.actRecordId
      ? sql`or (source_database_key = ${sourceDatabaseKey}
          and source_entity_type = ${source.streamType}
          and act_record_id = ${source.actRecordId})`
      : sql``;
    const rows = await this.query(sql`
      select id, entity_type as "entityType", entity_id as "entityId"
      from act_external_links
      where source_record_id = ${source.sourceRecordId} ${actCondition}
      order by id
      for update
    `, executor);
    if (rows.length > 1) throw repositoryError("archive_profile_source_link_ambiguous");
    return rows[0] ?? null;
  }

  private async alreadyImported(
    link: Row,
    source: ArchiveProfileSource,
    previousAttemptCount: number,
    executor: SqlExecutor,
  ): Promise<AppliedResolution> {
    const expected = entityTypeFor(source);
    if (link.entityType !== expected) throw repositoryError("archive_profile_source_link_invalid");
    const target = await this.lockTarget(expected, stringValue(link.entityId), executor);
    if (!target) throw repositoryError("archive_profile_source_link_invalid");
    return {
      status: "already_imported",
      targetEntityType: expected,
      targetEntityId: stringValue(link.entityId),
      reasonCode: null,
      retryAfter: null,
      attemptCount: previousAttemptCount,
      evidenceLabels: ["source_link"],
    };
  }

  private async applyResolution(
    job: LockedJob,
    source: ArchiveProfileSource,
    resolution: ArchiveProfileResolution,
    previousAttemptCount: number,
    executor: SqlExecutor,
  ): Promise<AppliedResolution> {
    if (resolution.action === "already_imported") {
      throw repositoryError("profile_source_link_stale");
    }
    const transactionalCandidates = await this.exactCandidates([source], executor);
    const transactionalResolution = resolveArchiveProfile({
      source,
      candidates: transactionalCandidates.get(source.sourceRecordId) ?? [],
      linkedTarget: null,
    });
    const transactionalActionable = isActionableResolution(transactionalResolution);
    if (isActionableResolution(resolution) && !transactionalActionable) {
      throw repositoryError("archive_profile_target_set_changed");
    }
    const effectiveResolution = transactionalActionable ? transactionalResolution : resolution;

    if (effectiveResolution.action === "retry_later") {
      const attemptCount = previousAttemptCount + 1;
      return {
        status: "retryable_failed",
        targetEntityType: null,
        targetEntityId: null,
        reasonCode: effectiveResolution.reasonCode,
        retryAfter: await this.retryAt(attemptCount, executor),
        attemptCount,
        evidenceLabels: effectiveResolution.evidenceLabels,
        provenance: effectiveResolution.provenance,
      };
    }
    if (effectiveResolution.action === "preserve") {
      return {
        status: "preserved",
        targetEntityType: null,
        targetEntityId: null,
        reasonCode: effectiveResolution.reasonCode,
        retryAfter: null,
        attemptCount: previousAttemptCount,
        evidenceLabels: effectiveResolution.evidenceLabels,
        provenance: effectiveResolution.provenance,
      };
    }
    if (effectiveResolution.action === "needs_ai") {
      throw repositoryError("archive_profile_resolution_pending", 400);
    }

    const expectedEntityType = entityTypeFor(source);
    if (effectiveResolution.targetEntityType !== expectedEntityType) {
      throw repositoryError("archive_profile_target_type_invalid", 400);
    }
    let targetId: string;
    let status: ResultStatus;
    let changedFields: string[] = [];
    if (effectiveResolution.action === "create_profile") {
      const created = await this.createTarget(expectedEntityType, source, effectiveResolution.values, executor);
      targetId = created.id;
      changedFields = created.changedFields;
      status = "created";
    } else {
      const rechecked = await this.recheckTarget(source, effectiveResolution, executor);
      targetId = effectiveResolution.targetEntityId;
      if (effectiveResolution.action === "update_existing" || rechecked.action === "update_existing") {
        const updated = await this.updateTarget(expectedEntityType, targetId, rechecked.values, rechecked.row, executor);
        changedFields = updated;
        status = updated.length > 0 ? "updated" : "linked";
      } else {
        status = "linked";
      }
    }

    if (expectedEntityType === "contact") {
      const organizationId = await this.linkContactParent(source, targetId, job.sourceDatabaseKey, executor);
      if (organizationId) changedFields = [...new Set([...changedFields, "organizationId"])].sort();
    }
    await this.insertSourceLink(source, expectedEntityType, targetId, job.sourceDatabaseKey, executor);
    if (changedFields.length > 0) {
      await this.insertAudit(job, source.sourceRecordId, expectedEntityType, targetId, changedFields, executor);
    }
    return {
      status,
      targetEntityType: expectedEntityType,
      targetEntityId: targetId,
      reasonCode: null,
      retryAfter: null,
      attemptCount: previousAttemptCount,
      evidenceLabels: effectiveResolution.evidenceLabels,
      provenance: effectiveResolution.provenance,
    };
  }

  private async recheckTarget(
    source: ArchiveProfileSource,
    resolution: Extract<ArchiveProfileResolution, { action: "link_existing" | "update_existing" }>,
    executor: SqlExecutor,
  ): Promise<{
    action: "link_existing" | "update_existing";
    values: Record<string, string | null>;
    row: Row;
  }> {
    const row = await this.lockTarget(resolution.targetEntityType, resolution.targetEntityId, executor);
    if (!row) throw repositoryError("profile_candidate_stale");
    const allowedSignals = resolution.evidenceLabels.filter((label): label is ProfileCandidate["exactSignals"][number] =>
      label === "email" || label === "phone_and_name" || label === "company_name_and_location",
    );
    if (allowedSignals.length === 0) throw repositoryError("profile_candidate_stale");
    const candidate: ProfileCandidate = {
      id: resolution.targetEntityId,
      entityType: resolution.targetEntityType,
      exactSignals: allowedSignals,
      values: candidateValues(resolution.targetEntityType, row),
    };
    const checked = resolveArchiveProfile({ source, candidates: [candidate], linkedTarget: null });
    if ((checked.action !== "link_existing" && checked.action !== "update_existing")
      || checked.targetEntityId !== resolution.targetEntityId) {
      throw repositoryError("profile_candidate_stale");
    }
    return { action: checked.action, values: checked.values, row };
  }

  private async lockTarget(
    entityType: EntityType,
    targetId: string,
    executor: SqlExecutor,
  ): Promise<Row | null> {
    const table = entityType === "organization" ? "organizations" : "contacts";
    const rows = await this.query(sql`
      select * from ${sql.raw(table)} where id = ${targetId} for update
    `, executor);
    return rows[0] ?? null;
  }

  private writableValues(
    entityType: EntityType,
    values: Record<string, string | null>,
  ): Record<string, string> {
    const columns = supportedColumns[entityType];
    return Object.fromEntries(Object.keys(columns).flatMap((field) => {
      const value = values[field];
      return typeof value === "string" && value.trim() ? [[field, value]] : [];
    }));
  }

  private async createTarget(
    entityType: EntityType,
    source: ArchiveProfileSource,
    values: Record<string, string | null>,
    executor: SqlExecutor,
  ): Promise<{ id: string; changedFields: string[] }> {
    if (!source.actRecordId) throw repositoryError("archive_profile_act_record_id_missing");
    const writable = this.writableValues(entityType, values);
    if (entityType === "organization") {
      if (!writable.name) throw repositoryError("archive_profile_identity_missing");
      const rows = await this.query(sql`
        insert into organizations
          (name, phone, website, act_industry, address_1,
           address_2, city, region, postal_code)
        values (${writable.name}, ${writable.phone ?? null},
          ${writable.website ?? null}, ${writable.industry ?? null},
          ${writable.address1 ?? null}, ${writable.address2 ?? null},
          ${writable.city ?? null}, ${writable.region ?? null}, ${writable.postalCode ?? null})
        returning id
      `, executor);
      if (!rows[0]) throw repositoryError("archive_profile_create_failed");
      return { id: stringValue(rows[0].id), changedFields: Object.keys(writable).sort() };
    }
    if (!writable.firstName || !writable.lastName) throw repositoryError("archive_profile_identity_missing");
    const rows = await this.query(sql`
      insert into contacts
        (first_name, last_name, email, phone, job_title,
         address_1, address_2, city, region, postal_code, organization_id)
      values (${writable.firstName}, ${writable.lastName},
        ${writable.email ?? null}, ${writable.phone ?? null}, ${writable.jobTitle ?? null},
        ${writable.address1 ?? null}, ${writable.address2 ?? null}, ${writable.city ?? null},
        ${writable.region ?? null}, ${writable.postalCode ?? null}, null)
      returning id
    `, executor);
    if (!rows[0]) throw repositoryError("archive_profile_create_failed");
    return { id: stringValue(rows[0].id), changedFields: Object.keys(writable).sort() };
  }

  private async updateTarget(
    entityType: EntityType,
    targetId: string,
    values: Record<string, string | null>,
    lockedRow: Row,
    executor: SqlExecutor,
  ): Promise<string[]> {
    const writable = this.writableValues(entityType, values);
    const columns = supportedColumns[entityType] as Record<string, string>;
    const changed = Object.keys(writable).filter((field) => nullableString(lockedRow[columns[field]!]) !== writable[field]);
    if (changed.length === 0) return [];
    const table = entityType === "organization" ? "organizations" : "contacts";
    const assignments = changed.map((field) => sql`${sql.raw(columns[field]!)} = ${writable[field]}`);
    assignments.push(sql`updated_at = now()`);
    await executor.execute(sql`
      update ${sql.raw(table)} set ${sql.join(assignments, sql`, `)} where id = ${targetId}
    `);
    return changed.sort();
  }

  private async linkContactParent(
    source: ArchiveProfileSource,
    contactId: string,
    sourceDatabaseKey: string,
    executor: SqlExecutor,
  ): Promise<string | null> {
    const companyActIds = this.companyActRecordIds(source.relationshipEvidence, source.actRecordId);
    if (source.relationshipEvidence.relationshipEvidenceComplete !== true
      || companyActIds.length !== 1) return null;
    const links = await this.query(sql`
      select entity_id as "entityId"
      from act_external_links
      where source_database_key = ${sourceDatabaseKey}
        and source_entity_type = 'company'
        and entity_type = 'organization'
        and act_record_id in (${sql.join(companyActIds.map((id) => sql`${id}`), sql`, `)})
      order by entity_id
      for update
    `, executor);
    const organizationIds = [...new Set(links.map((row) => stringValue(row.entityId)))];
    if (organizationIds.length !== 1) return null;
    const organization = await this.lockTarget("organization", organizationIds[0]!, executor);
    if (!organization) return null;
    await executor.execute(sql`
      insert into organization_contacts
        (organization_id, contact_id, active, is_primary, source, updated_at)
      values (${organizationIds[0]!}, ${contactId}, true, false, 'act_import', now())
      on conflict (organization_id, contact_id) do update
      set active = true, source = 'act_import', updated_at = now()
    `);
    await executor.execute(sql`
      update contacts set organization_id = ${organizationIds[0]!}, updated_at = now()
      where id = ${contactId}
        and organization_id is distinct from ${organizationIds[0]!}
    `);
    return organizationIds[0]!;
  }

  private async insertSourceLink(
    source: ArchiveProfileSource,
    entityType: EntityType,
    targetId: string,
    sourceDatabaseKey: string,
    executor: SqlExecutor,
  ): Promise<void> {
    if (!source.actRecordId) throw repositoryError("archive_profile_act_record_id_missing");
    const occupied = await this.query(sql`
      select exists (
        select 1 from act_external_links
        where entity_type = ${entityType}
          and entity_id = ${targetId}
          and source_entity_type = ${source.streamType}
          and is_primary = true
          and source_record_id is distinct from ${source.sourceRecordId}::uuid
      ) as occupied
    `, executor);
    const isPrimary = occupied[0]?.occupied !== true;
    await executor.execute(sql`
      insert into act_external_links
        (entity_type, entity_id, source_entity_type, act_record_id,
         source_database_key, source_record_id, is_primary, sync_mode)
      values (${entityType}, ${targetId}, ${source.streamType}, ${source.actRecordId},
        ${sourceDatabaseKey}, ${source.sourceRecordId}, ${isPrimary}, 'pull_only')
      on conflict do nothing
    `);
    const link = await this.lockSourceLink(source, sourceDatabaseKey, executor);
    if (!link || link.entityType !== entityType || stringValue(link.entityId) !== targetId) {
      throw repositoryError("archive_profile_source_link_conflict");
    }
  }

  private async insertAudit(
    job: LockedJob,
    sourceRecordId: string,
    entityType: EntityType,
    entityId: string,
    changedFields: readonly string[],
    executor: SqlExecutor,
  ): Promise<void> {
    const metadata = {
      jobId: job.id,
      runId: job.runId,
      sourceRecordId,
      changedFields: [...new Set(changedFields)].sort(),
      requestedBy: job.requestedBy,
    };
    await executor.execute(sql`
      insert into audit_entries (entity_type, entity_id, action, before, after)
      values (${entityType}, ${entityId}, 'act_archive_profile_imported', null,
        ${JSON.stringify(metadata)}::jsonb)
    `);
  }

  private async retryAt(attemptCount: number, executor: SqlExecutor): Promise<Date> {
    const backoffMs = calculateBackoffMs(attemptCount);
    const rows = await this.query(sql`
      select clock_timestamp() + ${backoffMs} * interval '1 millisecond' as "retryAt"
    `, executor);
    if (!rows[0]?.retryAt) throw repositoryError("archive_profile_retry_time_failed");
    return dateValue(rows[0].retryAt);
  }

  private async nextState(
    job: LockedJob,
    cursorSourceRecordId: string | null,
    executor: SqlExecutor,
  ): Promise<{
    phase: ActivePhase | "complete";
    cursorSourceRecordId: string | null;
    retryAfter: Date | null;
    lastErrorCode: string | null;
  }> {
    const newRows = await this.query(sql`
      select membership.source_record_id
      from act_archive_profile_import_sources membership
      left join act_archive_profile_import_results results
        on results.job_id = membership.job_id and results.source_record_id = membership.source_record_id
      where membership.job_id = ${job.id}
        and membership.phase = ${job.phase}
        and results.id is null
      order by membership.source_record_id limit 1
    `, executor);
    if (newRows.length > 0) {
      return { phase: job.phase, cursorSourceRecordId, retryAfter: null, lastErrorCode: null };
    }
    const retryRows = await this.query(sql`
      select results.retry_after as "retryAfter", results.reason_code as "reasonCode",
        (results.retry_after is not null
          and results.retry_after > clock_timestamp()) as "retryInFuture"
      from act_archive_profile_import_results results
      inner join act_archive_profile_import_sources membership
        on membership.job_id = results.job_id and membership.source_record_id = results.source_record_id
      where results.job_id = ${job.id}
        and results.status = 'retryable_failed'
        and membership.phase = ${job.phase}
      order by results.retry_after nulls first, membership.source_record_id
      limit 1
    `, executor);
    if (retryRows[0]) {
      const retryAfter = retryRows[0].retryAfter == null ? null : dateValue(retryRows[0].retryAfter);
      return {
        phase: job.phase,
        cursorSourceRecordId,
        retryAfter: retryRows[0].retryInFuture === true ? retryAfter : null,
        lastErrorCode: nullableString(retryRows[0].reasonCode),
      };
    }
    return {
      phase: job.phase === "companies" ? "contacts" : "complete",
      cursorSourceRecordId: null,
      retryAfter: null,
      lastErrorCode: null,
    };
  }

  async failBatch(
    input: ClaimedArchiveProfileJob & {
      errorCode: string;
      retryable: boolean;
      now: Date;
    },
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const executor = transaction as unknown as SqlExecutor;
      const job = await this.lockClaim(input, input.now, executor);
      const code = safeErrorCode(input.errorCode);
      const fenced = await this.query(sql`
        update act_archive_profile_import_jobs
        set phase = ${input.retryable ? job.phase : "failed"},
          failure_attempt_count = failure_attempt_count + 1,
          retry_after = case when ${input.retryable} then
            clock_timestamp() + least(
              300000::double precision,
              5000::double precision * power(2::double precision, failure_attempt_count)
            ) * interval '1 millisecond'
          else null end,
          last_error_code = ${code},
          completed_at = case when ${input.retryable} then null else clock_timestamp() end,
          lease_owner = null, lease_token = null, lease_expires_at = null,
          updated_at = clock_timestamp()
        where id = ${job.id} and lease_token = ${job.leaseToken}
          and lease_expires_at > clock_timestamp()
        returning id
      `, executor);
      if (fenced.length !== 1) throw repositoryError("archive_profile_lease_lost");
    });
  }
}
