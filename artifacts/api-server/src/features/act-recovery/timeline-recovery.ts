import { sql } from "drizzle-orm";

import type { db as applicationDatabase } from "@/db/client";
import { normalizeTimeline } from "@/features/act-replacement/normalizers/timeline-normalizer";
import { parseInlineRelationshipRecords } from "@/features/act-replacement/source-record-parser";
import type { RecoveryCandidate } from "./recovery-types";
import type { RecoveryApplyResult } from "./entity-recovery";
import { ActRecoverySourceLinkResolver } from "./source-link-resolver";

type DrizzleDatabase = typeof applicationDatabase;
type Row = Record<string, unknown>;
type TimelineSourceType = "note" | "history" | "activity";
type Parent = { entityType: "organization" | "contact" | "booking"; entityId: string };

type InlineTargetKind = "company" | "contact" | "opportunity";

function rows(value: unknown): Row[] {
  if (Array.isArray(value)) return value as Row[];
  const result = (value as { rows?: unknown })?.rows;
  return Array.isArray(result) ? result as Row[] : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function inlineTargetKind(value: unknown): InlineTargetKind | null {
  return value === "company" || value === "contact" || value === "opportunity"
    ? value
    : null;
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

    const exactParents = await this.resolveParents(
      sourceDatabaseKey,
      sourceType,
      candidate.actRecordId,
      candidate.rawSnapshot,
    );
    const manualParent = await this.resolveManualParent(candidate);
    const parentMap = new Map<string, Parent>();
    for (const parent of exactParents) parentMap.set(`${parent.entityType}:${parent.entityId}`, parent);
    if (manualParent) parentMap.set(`${manualParent.entityType}:${manualParent.entityId}`, manualParent);
    const parents = [...parentMap.values()].sort((left, right) =>
      left.entityType.localeCompare(right.entityType) || left.entityId.localeCompare(right.entityId),
    );
    if (!parents.length) {
      return {
        state: "needs_review",
        targetSummary: { reason: "timeline_parent_unresolved", sourceType },
      };
    }

    const legacyKey = actTimelineKey(sourceType, candidate.actRecordId);
    const existing = legacyKey
      ? await this.query(sql`
          select id, body, source_record_id as "sourceRecordId", source_version_id as "sourceVersionId", source_type as "sourceType"
          from activities
          where source_record_id = ${candidate.sourceRecordId}
            or act_record_id = ${legacyKey}
          order by case when source_record_id = ${candidate.sourceRecordId} then 0 else 1 end, id
          limit 2
        `)
      : await this.query(sql`
          select id, body, source_record_id as "sourceRecordId", source_version_id as "sourceVersionId", source_type as "sourceType"
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
    let contentRepaired = false;
    let deduplicatedByContent = false;
    if (!activityId) {
      activityId = await this.findExactImportedDuplicate(
        normalized.value.body,
        new Date(normalized.value.timelineSortAt),
        parents,
      );
      deduplicatedByContent = Boolean(activityId);
    }
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
    } else if (!deduplicatedByContent && !text(existing[0]?.sourceRecordId)) {
      await this.database.execute(sql`
        update activities
        set source_record_id = ${candidate.sourceRecordId}, source_version_id = ${candidate.sourceVersionId},
          source_type = ${sourceType}, updated_at = now()
        where id = ${activityId} and source_record_id is null
      `);
      provenanceRepaired = true;
    }

    if (activityId && existing[0] && text(existing[0].body) !== normalized.value.body) {
      await this.database.execute(sql`
        update activities
        set body = ${normalized.value.body}, updated_at = now()
        where id = ${activityId}
      `);
      contentRepaired = true;
    }

    let associationsAdded = 0;
    for (const parent of parents) {
      associationsAdded += await this.ensureAssociation(activityId, parent);
    }
    const ownershipRepair = await this.reconcileOwnership(activityId, parents);
    const changed = created
      || provenanceRepaired
      || contentRepaired
      || associationsAdded > 0
      || ownershipRepair.directParentsCleared > 0
      || ownershipRepair.staleAssociationsRemoved > 0;
    return {
      state: changed ? "recovered" : "already_present",
      targetSummary: {
        entityType: "activity",
        entityId: activityId,
        sourceType,
        created,
        provenanceRepaired,
        contentRepaired,
        deduplicatedByContent,
        associationsAdded,
        directParentsCleared: ownershipRepair.directParentsCleared,
        staleAssociationsRemoved: ownershipRepair.staleAssociationsRemoved,
        parentCount: parents.length,
        manuallyAssigned: Boolean(manualParent),
      },
    };
  }

  private async findExactImportedDuplicate(
    body: string,
    timelineSortAt: Date,
    parents: Parent[],
  ): Promise<string> {
    if (!parents.length) return "";
    const parentConditions = parents.map((parent) => {
      if (parent.entityType === "organization") {
        return sql`(
          candidate.organization_id = ${parent.entityId}
          or exists (
            select 1 from activity_associations association
            where association.activity_id = candidate.id
              and association.organization_id = ${parent.entityId}
          )
        )`;
      }
      if (parent.entityType === "contact") {
        return sql`(
          candidate.contact_id = ${parent.entityId}
          or exists (
            select 1 from activity_associations association
            where association.activity_id = candidate.id
              and association.contact_id = ${parent.entityId}
          )
        )`;
      }
      return sql`(
        candidate.booking_id = ${parent.entityId}
        or exists (
          select 1 from activity_associations association
          where association.activity_id = candidate.id
            and association.booking_id = ${parent.entityId}
        )
      )`;
    });
    const found = await this.query(sql`
      select candidate.id
      from activities candidate
      where candidate.source_record_id is not null
        and (to_jsonb(candidate)->>'deleted_at') is null
        and candidate.body = ${body}
        and candidate.timeline_sort_at = ${timelineSortAt}
        and (${sql.join(parentConditions, sql` or `)})
      order by candidate.id
      limit 1
    `);
    return text(found[0]?.id);
  }

  private async resolveParents(
    sourceDatabaseKey: string,
    sourceType: TimelineSourceType,
    actRecordId: string | null,
    rawSnapshot: Record<string, unknown>,
  ): Promise<Parent[]> {
    const found = new Map<string, Parent>();

    if (actRecordId) {
      const relationships = await this.query(sql`
        select id
        from act_source_records
        where source_database_key = ${sourceDatabaseKey}
          and stream_type in (${`${sourceType}_company`}, ${`${sourceType}_contact`}, ${`${sourceType}_opportunity`})
          and relationship_evidence->>'parentActRecordId' = ${actRecordId}
        order by id
      `);
      for (const row of relationships) {
        const relationship = await this.resolver.resolveRelationship(text(row.id));
        if (relationship.kind !== "resolved" || relationship.target.kind !== "resolved") continue;
        this.addResolvedParent(found, relationship.target);
      }
    }

    const inlineRelationships = parseInlineRelationshipRecords({
      parentKind: sourceType,
      parentRecord: rawSnapshot,
    });
    for (const item of inlineRelationships.items) {
      const targetKind = inlineTargetKind(item.relationshipEvidence.targetKind);
      const targetActRecordId = text(item.relationshipEvidence.targetActRecordId).trim();
      if (!targetKind || !targetActRecordId) continue;
      const sourceRows = await this.query(sql`
        select id
        from act_source_records
        where source_database_key = ${sourceDatabaseKey}
          and stream_type = ${targetKind}
          and act_record_id = ${targetActRecordId}
        order by id
        limit 2
      `);
      if (sourceRows.length !== 1) continue;
      const target = await this.resolver.resolveLocalSource(text(sourceRows[0]?.id));
      if (target.kind !== "resolved") continue;
      this.addResolvedParent(found, target);
    }

    return [...found.values()].sort((left, right) =>
      left.entityType.localeCompare(right.entityType) || left.entityId.localeCompare(right.entityId),
    );
  }

  private addResolvedParent(
    found: Map<string, Parent>,
    target: { entityType: string; entityId: string },
  ) {
    if (target.entityType !== "organization" && target.entityType !== "contact" && target.entityType !== "booking") return;
    found.set(`${target.entityType}:${target.entityId}`, {
      entityType: target.entityType,
      entityId: target.entityId,
    });
  }

  private async resolveManualParent(candidate: RecoveryCandidate): Promise<Parent | null> {
    try {
      const decisions = await this.query(sql`
        select target_entity_type as "targetEntityType", target_entity_id as "targetEntityId"
        from act_archive_recovery_decisions
        where run_id = ${candidate.runId}
          and source_record_id = ${candidate.sourceRecordId}
          and source_version_id = ${candidate.sourceVersionId}
          and decision = 'assign_parent'
        order by created_at desc, id desc
        limit 1
      `);
      const entityType = text(decisions[0]?.targetEntityType);
      const entityId = text(decisions[0]?.targetEntityId);
      if (!entityId || (entityType !== "organization" && entityType !== "contact" && entityType !== "booking")) {
        return null;
      }
      return { entityType, entityId };
    } catch (error) {
      // Focused unit fixtures created before the recovery-review table exists should
      // still exercise exact relationship recovery. Production always has migration 043.
      const directCode = error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code ?? "")
        : "";
      const cause = error && typeof error === "object" && "cause" in error
        ? (error as { cause?: unknown }).cause
        : null;
      const causeCode = cause && typeof cause === "object" && "code" in cause
        ? String((cause as { code?: unknown }).code ?? "")
        : "";
      if (directCode === "42P01" || causeCode === "42P01") return null;
      throw error;
    }
  }

  private async reconcileOwnership(
    activityId: string,
    parents: Parent[],
  ): Promise<{ directParentsCleared: number; staleAssociationsRemoved: number }> {
    const cleared = await this.query(sql`
      update activities
      set organization_id = null, contact_id = null, booking_id = null, updated_at = now()
      where id = ${activityId}
        and (organization_id is not null or contact_id is not null or booking_id is not null)
      returning id
    `);
    const canonicalConditions = parents.map((parent) => {
      if (parent.entityType === "organization") {
        return sql`coalesce(organization_id = ${parent.entityId}, false)`;
      }
      if (parent.entityType === "contact") {
        return sql`coalesce(contact_id = ${parent.entityId}, false)`;
      }
      return sql`coalesce(booking_id = ${parent.entityId}, false)`;
    });
    const removed = await this.query(sql`
      delete from activity_associations
      where activity_id = ${activityId}
        and not (${sql.join(canonicalConditions, sql` or `)})
      returning id
    `);
    return {
      directParentsCleared: cleared.length,
      staleAssociationsRemoved: removed.length,
    };
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
