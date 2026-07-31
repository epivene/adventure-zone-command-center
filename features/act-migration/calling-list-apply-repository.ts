import { and, asc, eq, inArray, sql } from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  actExternalLinks,
  actMigrationApplyOperations,
  actMigrationProposals,
  actMigrationRecords,
  callingLists,
  contacts,
} from "@/db/schema";
import type { MigrationApplyOperation } from "@/features/act-migration/apply-repository";
import { recordAuditEntry } from "@/features/audit/audit-service";
import {
  CallingListRepository,
  type CallingListTransaction,
} from "@/features/calling-lists/calling-list-repository";

type DrizzleDatabase = typeof database;
type Values = Record<string, unknown>;

export type MigrationCallingListApplyResult = { entityId: string; changed: boolean };

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export class MigrationCallingListApplyRepository {
  constructor(
    private readonly database: DrizzleDatabase,
    private readonly callingLists: CallingListRepository = new CallingListRepository(database),
  ) {}

  applyCallingList(operation: MigrationApplyOperation): Promise<MigrationCallingListApplyResult> {
    if (operation.targetEntityType !== "calling_list") throw new Error("Expected a Calling List apply operation.");
    return this.database.transaction((transaction) => this.applyCallingListIn(transaction, operation));
  }

  applyMembership(operation: MigrationApplyOperation): Promise<MigrationCallingListApplyResult> {
    if (operation.targetEntityType !== "calling_list_member") throw new Error("Expected a Calling List Membership apply operation.");
    return this.database.transaction((transaction) => this.applyMembershipIn(transaction, operation));
  }

  private async lockOperation(transaction: CallingListTransaction, operation: MigrationApplyOperation) {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${`${operation.runId}:${operation.proposalKey}`}))`);
    const records = await transaction.select().from(actMigrationRecords).where(and(
      eq(actMigrationRecords.runId, operation.runId),
      inArray(actMigrationRecords.sourceKey, [...operation.proposal.sourceRecordKeys]),
    )).orderBy(asc(actMigrationRecords.sourceKey)).for("update");
    if (records.length !== operation.proposal.sourceRecordKeys.length || new Set(records.map((record) => record.sourceKey)).size !== operation.proposal.sourceRecordKeys.length) {
      throw new Error("Act migration staged source records are incomplete.");
    }
    return records;
  }

  private async dependencyIds(transaction: CallingListTransaction, operation: MigrationApplyOperation) {
    if (operation.dependencyProposalKeys.length === 0) return new Map<string, { targetEntityType: string; entityId: string }>();
    const rows = await transaction.select().from(actMigrationApplyOperations).where(and(
      eq(actMigrationApplyOperations.runId, operation.runId),
      inArray(actMigrationApplyOperations.proposalKey, [...operation.dependencyProposalKeys]),
    )).orderBy(asc(actMigrationApplyOperations.proposalKey)).for("update");
    const values = new Map(rows.flatMap((row) => row.status === "applied" && row.appliedEntityId
      ? [[row.proposalKey, { targetEntityType: row.targetEntityType, entityId: row.appliedEntityId }] as const]
      : []));
    if (values.size !== operation.dependencyProposalKeys.length) throw new Error("Act migration dependency is not applied.");
    return values;
  }

  private dependency(dependencies: Map<string, { targetEntityType: string; entityId: string }>, targetEntityType: string) {
    const match = [...dependencies.entries()].find(([, value]) => value.targetEntityType === targetEntityType);
    if (!match) throw new Error(`Act migration dependency is missing ${targetEntityType}.`);
    return { proposalKey: match[0], entityId: match[1].entityId };
  }

  private async applyCallingListIn(transaction: CallingListTransaction, operation: MigrationApplyOperation): Promise<MigrationCallingListApplyResult> {
    if (operation.proposal.decision !== "confirm_static_group") throw new Error("Act Group membership semantics require confirm_static_group.");
    const records = await this.lockOperation(transaction, operation);
    const group = records.find((record) => record.streamType === "group" && record.sourceId !== null);
    if (!group) throw new Error("Act migration Calling List has no staged Group record.");
    const name = text((group.normalizedSnapshot as Values).displayName);
    if (!name) throw new Error("Act migration Group has no name.");
    const result = await this.callingLists.createOrVerifyStaticListIn(transaction, { name, sourceId: group.sourceId!, runId: operation.runId });
    if (result.changed) await recordAuditEntry(transaction, {
      entityType: "calling_list", entityId: result.entityId, action: "act_migration_applied", before: null,
      after: { sourceIds: [group.sourceId!], state: "static" },
    });
    return result;
  }

  private async applyMembershipIn(transaction: CallingListTransaction, operation: MigrationApplyOperation): Promise<MigrationCallingListApplyResult> {
    const records = await this.lockOperation(transaction, operation);
    const edge = records.find((record) => record.streamType === "group_contact" && record.sourceId !== null && record.targetSourceId !== null);
    if (!edge) throw new Error("Act migration Calling List Membership has no staged Group Contact record.");
    const dependencies = await this.dependencyIds(transaction, operation);
    const callingList = this.dependency(dependencies, "calling_list");
    const [listProposal] = await transaction.select({ decision: actMigrationProposals.decision }).from(actMigrationProposals).where(and(
      eq(actMigrationProposals.runId, operation.runId),
      eq(actMigrationProposals.proposalKey, callingList.proposalKey),
    )).limit(1).for("update");
    if (listProposal?.decision !== "confirm_static_group") {
      throw new Error("Act migration membership requires a confirmed static calling list.");
    }
    const appliedContactId = [...dependencies.values()].find((value) => value.targetEntityType === "contact")?.entityId;
    const contactId = appliedContactId ?? await this.stableContactId(transaction, edge.targetSourceId!);
    if (!contactId) throw new Error("Act migration dependency is missing contact.");
    const [contact] = await transaction.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, contactId)).limit(1).for("update");
    if (!contact) throw new Error("Act migration dependency entity is missing.");
    const [list] = await transaction.select({ id: callingLists.id, kind: callingLists.kind }).from(callingLists).where(eq(callingLists.id, callingList.entityId)).limit(1).for("update");
    if (!list) throw new Error("Act migration dependency entity is missing.");
    if (list.kind !== "static") throw new Error("Dynamic calling lists cannot have materialized memberships.");
    const result = await this.callingLists.createOrReactivateMembershipIn(transaction, { callingListId: callingList.entityId, contactId });
    if (result.changed) await recordAuditEntry(transaction, {
      entityType: "calling_list_membership", entityId: result.entityId, action: "act_migration_applied", before: null,
      after: { sourceIds: [edge.sourceId!, edge.targetSourceId!], state: "active" },
    });
    return result;
  }

  private async stableContactId(transaction: CallingListTransaction, sourceId: string) {
    const [link] = await transaction.select({ entityId: actExternalLinks.entityId, entityType: actExternalLinks.entityType })
      .from(actExternalLinks).where(and(eq(actExternalLinks.sourceEntityType, "contact"), eq(actExternalLinks.actRecordId, sourceId))).limit(1).for("update");
    return link?.entityType === "contact" ? link.entityId : null;
  }
}
