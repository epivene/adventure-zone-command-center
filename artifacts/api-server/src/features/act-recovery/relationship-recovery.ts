import { allocationEnabled, activeAllocationTransactions } from "@/features/outreach-planner/outreach-allocation";
import { reconcileCapacityFacts } from "@/features/outreach-planner/outreach-commitments";
import { sql } from "drizzle-orm";

import type { db as applicationDatabase } from "@/db/client";
import type { RecoveryCandidate } from "./recovery-types";
import type { RecoveryApplyResult } from "./entity-recovery";
import { ActRecoverySourceLinkResolver } from "./source-link-resolver";

type DrizzleDatabase = typeof applicationDatabase;
type Row = Record<string, unknown>;

function rows(value: unknown): Row[] {
  if (Array.isArray(value)) return value as Row[];
  const result = (value as { rows?: unknown })?.rows;
  return Array.isArray(result) ? result as Row[] : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

export class ActRelationshipRecovery {
  constructor(
    private readonly database: DrizzleDatabase,
    private readonly resolver: ActRecoverySourceLinkResolver,
  ) {}

  private async query(query: ReturnType<typeof sql>): Promise<Row[]> {
    return rows(await this.database.execute(query));
  }

  async recoverRelationship(candidate: RecoveryCandidate): Promise<RecoveryApplyResult> {
    if(allocationEnabled() && !activeAllocationTransactions.has(this.database)) return reconcileCapacityFacts(this.database,"act-history-import",async tx=>new ActRelationshipRecovery(tx as unknown as DrizzleDatabase,new ActRecoverySourceLinkResolver(tx as unknown as DrizzleDatabase)).recoverRelationship(candidate));
    const resolved = await this.resolver.resolveRelationship(candidate.sourceRecordId);
    if (resolved.kind === "invalid") {
      return {
        state: resolved.reason === "invalid_relationship_evidence" ? "dropped_unusable" : "needs_review",
        targetSummary: { reason: resolved.reason },
      };
    }
    const parent = await this.resolver.resolveLocalSource(resolved.relationship.parentSourceRecordId);
    const target = resolved.target;
    if (parent.kind !== "resolved" || target.kind !== "resolved") {
      return {
        state: "needs_review",
        targetSummary: {
          reason: "relationship_parent_unresolved",
          parent,
          target,
        },
      };
    }

    switch (candidate.streamType) {
      case "company_contact": {
        if (parent.entityType !== "contact" || target.entityType !== "organization") {
          return { state: "needs_review", targetSummary: { reason: "relationship_type_mismatch" } };
        }
        const existing = await this.query(sql`
          select id from organization_contacts
          where organization_id = ${target.entityId} and contact_id = ${parent.entityId}
          limit 1
        `);
        if (existing[0]) return { state: "already_present", targetSummary: { organizationId: target.entityId, contactId: parent.entityId } };
        await this.database.execute(sql`
          insert into organization_contacts
            (organization_id, contact_id, source, active, created_at, updated_at)
          values (${target.entityId}, ${parent.entityId}, 'act_recovery', true, now(), now())
          on conflict do nothing
        `);
        return { state: "recovered", targetSummary: { organizationId: target.entityId, contactId: parent.entityId } };
      }
      case "opportunity_company": {
        if (parent.entityType !== "booking" || target.entityType !== "organization") {
          return { state: "needs_review", targetSummary: { reason: "relationship_type_mismatch" } };
        }
        const booking = (await this.query(sql`
          select organization_id as "organizationId" from bookings where id = ${parent.entityId} limit 1
        `))[0];
        if (!booking) return { state: "needs_review", targetSummary: { reason: "booking_missing" } };
        const currentOrganizationId = text(booking.organizationId);
        if (currentOrganizationId && currentOrganizationId !== target.entityId) {
          return {
            state: "needs_review",
            targetSummary: {
              reason: "booking_organization_conflict",
              currentOrganizationId,
              archivedOrganizationId: target.entityId,
            },
          };
        }
        if (currentOrganizationId === target.entityId) {
          return { state: "already_present", targetSummary: { bookingId: parent.entityId, organizationId: target.entityId } };
        }
        await this.database.execute(sql`
          update bookings set organization_id = ${target.entityId}, updated_at = now()
          where id = ${parent.entityId} and organization_id is null
        `);
        return { state: "recovered", targetSummary: { bookingId: parent.entityId, organizationId: target.entityId } };
      }
      case "opportunity_contact": {
        if (parent.entityType !== "booking" || target.entityType !== "contact") {
          return { state: "needs_review", targetSummary: { reason: "relationship_type_mismatch" } };
        }
        const existing = await this.query(sql`
          select id from booking_contacts
          where booking_id = ${parent.entityId} and contact_id = ${target.entityId}
          limit 1
        `);
        if (existing[0]) return { state: "already_present", targetSummary: { bookingId: parent.entityId, contactId: target.entityId } };
        await this.database.execute(sql`
          insert into booking_contacts
            (booking_id, contact_id, is_primary, source, created_at, updated_at)
          values (${parent.entityId}, ${target.entityId}, false, 'act_recovery', now(), now())
          on conflict do nothing
        `);
        return { state: "recovered", targetSummary: { bookingId: parent.entityId, contactId: target.entityId } };
      }
      case "group_contact": {
        if (parent.entityType !== "calling_list" || target.entityType !== "contact") {
          return { state: "needs_review", targetSummary: { reason: "relationship_type_mismatch" } };
        }
        const existing = await this.query(sql`
          select id from calling_list_memberships
          where calling_list_id = ${parent.entityId} and contact_id = ${target.entityId} and active = true
          limit 1
        `);
        if (existing[0]) return { state: "already_present", targetSummary: { callingListId: parent.entityId, contactId: target.entityId } };
        await this.database.execute(sql`
          insert into calling_list_memberships
            (calling_list_id, contact_id, source, active, created_at, updated_at)
          values (${parent.entityId}, ${target.entityId}, 'act_recovery', true, now(), now())
          on conflict do nothing
        `);
        return { state: "recovered", targetSummary: { callingListId: parent.entityId, contactId: target.entityId } };
      }
      default:
        return { state: "dropped_unusable", targetSummary: { reason: "unsupported_crm_relationship" } };
    }
  }
}
