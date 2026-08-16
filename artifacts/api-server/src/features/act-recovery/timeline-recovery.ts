import { sql } from "drizzle-orm";

import type { db as applicationDatabase } from "@/db/client";
import { normalizeTimeline } from "@/features/act-replacement/normalizers/timeline-normalizer";
import type { RecoveryCandidate } from "./recovery-types";
import type { RecoveryApplyResult } from "./entity-recovery";
import { ActRecoverySourceLinkResolver } from "./source-link-resolver";

type DrizzleDatabase = typeof applicationDatabase;
type Row = Record<string, unknown>;
type TimelineSourceType = "note" | "history" | "activity";
type Parent = { entityType: "organization" | "contact" | "booking"; entityId: string };

function rows(value: unknown): Row[] {
  if (Array.isArray(value)) return value as Row[];
  const result = (value as { rows?: unknown })?.rows;
  return Array.isArray(result) ? result as Row[] : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function actTimelineKey(sourceType: TimelineSourceType, actRecordId: string | null) {
  return actRecordId ? `act_${sourceType}:${actRecordId}` : null;
}

function capturedAt(candidate: RecoveryCandidate) {
  const explicit = candidate.capturedAt;
  if (typeof explicit === "string" && !Number.isNaN(new Date(explicit).getTime())) return explicit;
  const raw = candidate.rawSnapshot;
  for (const key of ["edited", "Edited", "createDate", "CreateDate", "created", "Created"]) {
    const value = raw[key];
    if (typeof value === "string" && !Number.isNaN(new Date(value).getTime())) return value;
  }
  return new Date().toISOString();
}

export class ActTimelineRecovery {
  constructor(
    private readonly database: DrizzleDatabase,
    private readonly resolver: ActRecoverySourceLinkResolver,
  ) {}

  private async query(query: ReturnType<typeof sql>): Promise<Row[]> {
    return rows(await this.database.execute(query));
  }

  async recoverTimeline(candidate: RecoveryCandidate): Promise<RecoveryApplyResult> {
    if (candidate.streamType !== "note" && candidate.streamType !== "history" && candidate.streamType !== "activity") {
      return { state: "dropped_unusable", targetSummary: { reason: "not_timeline_source" } };
    }
    const sourceType: TimelineSourceType = candidate.streamType;
    const normalized = normalizeTimeline(candidate.rawSnapshot, capturedAt(candidate), sourceType);
    if (!normalized.ok) {
      return {
        state: normalized.issueCode === "missing_required_timeline_body" ? "dropped_unusable" : "needs_review",
        targetSummary: { reason: normalized.issueCode },
      };
    }

    const sourceScope = (await this.query(sql`
      select source_database_key as "sourceDatabaseKey"
      from act_source_records where id = ${candidate.sourceRecordId} limit 1
    `))[0];
    const sourceDatabaseKey = text(sourceScope?.sourceDatabaseKey);
    if (!sourceDatabaseKey) return { state: "needs_review", targetSummary: { reason: "source_scope_missing" } };

    const parents = await this.resolveParents(sourceDatabaseKey, sourceType, candidate.actRecordId);
    if (!parents.length) {
      return {
        state: "needs_review",
        targetSummary: { reason: "timeline_parent_unresolved", sourceType },
      };
    }

    const legacyKey = actTimelineKey(sourceType, candidate.actRecordId);
    const existing = legacyKey
      ? await this.query(sql`
          select id, source_record_id as "sourceRecordId", source_version_id as "sourceVersionId", source_type as "sourceType"
          from activities
          where source_record_id = ${candidate.sourceRecordId}
            or act_record_id = ${legacyKey}
          order by case when source_record_id = ${candidate.sourceRecordId} then 0 else 1 end, id
          limit 2
        `)
      : await this.query(sql`
          select id, source_record_id as "sourceRecordId", source_version_id as "sourceVersionId", source_type as "sourceType"
          from activities
          where source_record_id = ${candidate.sourceRecordId}
          order by id
          limit 2
        `);
    if (existing.length > 1) {
      return { state: "needs_review", targetSummary: { reason: "duplicate_local_timeline_source" } };
    }

    let activityId = text(existing[0]?.id);
    let created = false;
    let provenanceRepaired = false;
    if (!activityId) {
      const occurredAt = normalized.value.sourceOccurredAt ? new Date(normalized.value.sourceOccurredAt) : null;
      const endsAt = normalized.value.endsAt ? new Date(normalized.value.endsAt) : null;
      const inserted = await this.query(sql`
        insert into activities
          (kind, subject, status, body, occurred_at, timeline_sort_at, date_is_import_fallback,
           ends_at, act_record_id, source_record_id, source_version_id, source_type, created_at, updated_at)
        values (${normalized.value.category}, ${normalized.value.subject}, ${normalized.value.status},
          ${normalized.value.body}, ${occurredAt}, ${new Date(normalized.value.timelineSortAt)},
          ${normalized.value.dateIsImportFallback}, ${endsAt}, ${legacyKey}, ${candidate.sourceRecordId},
          ${candidate.sourceVersionId}, ${sourceType}, now(), now())
        returning id
      `);
      activityId = text(inserted[0]?.id);
      created = true;
    } else if (!text(existing[0]?.sourceRecordId)) {
      await this.database.execute(sql`
        update activities
        set source_record_id = ${candidate.sourceRecordId}, source_version_id = ${candidate.sourceVersionId},
          source_type = ${sourceType}, updated_at = now()
        where id = ${activityId} and source_record_id is null
      `);
      provenanceRepaired = true;
    }

    let associationsAdded = 0;
    for (const parent of parents) {
      associationsAdded += await this.ensureAssociation(activityId, parent);
    }
    const changed = created || provenanceRepaired || associationsAdded > 0;
    return {
      state: changed ? "recovered" : "already_present",
      targetSummary: {
        entityType: "activity",
        entityId: activityId,
        sourceType,
        created,
        provenanceRepaired,
        associationsAdded,
        parentCount: parents.length,
      },
    };
  }

  private async resolveParents(
    sourceDatabaseKey: string,
    sourceType: TimelineSourceType,
    actRecordId: string | null,
  ): Promise<Parent[]> {
    if (!actRecordId) return [];
    const relationships = await this.query(sql`
      select id
      from act_source_records
      where source_database_key = ${sourceDatabaseKey}
        and stream_type in (${`${sourceType}_company`}, ${`${sourceType}_contact`}, ${`${sourceType}_opportunity`})
        and relationship_evidence->>'parentActRecordId' = ${actRecordId}
      order by id
    `);
    const found = new Map<string, Parent>();
    for (const row of relationships) {
      const relationship = await this.resolver.resolveRelationship(text(row.id));
      if (relationship.kind !== "resolved" || relationship.target.kind !== "resolved") continue;
      const target = relationship.target;
      if (target.entityType !== "organization" && target.entityType !== "contact" && target.entityType !== "booking") continue;
      found.set(`${target.entityType}:${target.entityId}`, {
        entityType: target.entityType,
        entityId: target.entityId,
      });
    }
    return [...found.values()].sort((left, right) =>
      left.entityType.localeCompare(right.entityType) || left.entityId.localeCompare(right.entityId),
    );
  }

  private async ensureAssociation(activityId: string, parent: Parent): Promise<number> {
    if (parent.entityType === "organization") {
      const existing = await this.query(sql`
        select id from activity_associations where activity_id = ${activityId} and organization_id = ${parent.entityId} limit 1
      `);
      if (existing[0]) return 0;
      await this.database.execute(sql`
        insert into activity_associations (activity_id, organization_id) values (${activityId}, ${parent.entityId}) on conflict do nothing
      `);
      return 1;
    }
    if (parent.entityType === "contact") {
      const existing = await this.query(sql`
        select id from activity_associations where activity_id = ${activityId} and contact_id = ${parent.entityId} limit 1
      `);
      if (existing[0]) return 0;
      await this.database.execute(sql`
        insert into activity_associations (activity_id, contact_id) values (${activityId}, ${parent.entityId}) on conflict do nothing
      `);
      return 1;
    }
    const existing = await this.query(sql`
      select id from activity_associations where activity_id = ${activityId} and booking_id = ${parent.entityId} limit 1
    `);
    if (existing[0]) return 0;
    await this.database.execute(sql`
      insert into activity_associations (activity_id, booking_id) values (${activityId}, ${parent.entityId}) on conflict do nothing
    `);
    return 1;
  }
}
