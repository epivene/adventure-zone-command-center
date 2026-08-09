import { and, eq, isNull } from "drizzle-orm";

import type { db as database } from "@/db/client";
import { actSourceAssignments, actSourceRecords } from "@workspace/db/schema";

type DrizzleDatabase = typeof database;
type AssignmentRow = typeof actSourceAssignments.$inferSelect;

const targetTypes = new Set(["organization", "contact", "booking", "calling_list", "activity"]);
const sourceTargetType = new Map([["company", "organization"], ["contact", "contact"], ["opportunity", "booking"], ["group", "calling_list"], ["activity", "activity"]]);

export class AssignmentValidationError extends Error {
  readonly code = "ACT_ASSIGNMENT_INVALID";
  readonly status = 400;
  constructor() { super("Act source assignment is invalid."); this.name = "AssignmentValidationError"; }
}

export class AssignmentVersionConflictError extends Error {
  readonly code = "ACT_ASSIGNMENT_VERSION_CONFLICT";
  readonly status = 409;
  constructor() { super("Act source assignment is based on a stale source version."); this.name = "AssignmentVersionConflictError"; }
}

export class AssignmentRepositoryError extends Error {
  readonly code = "ACT_ASSIGNMENT_STORE_FAILED";
  readonly status = 500;
  constructor() { super("Act source assignment could not be stored."); this.name = "AssignmentRepositoryError"; }
}

export type AssignSourceParentInput = {
  sourceRecordId: string;
  targetEntityType: "organization" | "contact" | "booking" | "calling_list" | "activity";
  targetEntityId: string;
  role?: string;
  isPrimary?: boolean;
  assignedBy: string;
  sourceVersionId?: string | null;
  expectedSourceVersionId?: string | null;
  /** Replay is scoped to this repository instance; no durable request-key column exists in the current schema. */
  requestKey?: string;
};

export type SupersedeSourceAssignmentInput = {
  assignmentId: string;
  sourceRecordId: string;
  supersededBy: string;
  expectedSourceVersionId?: string | null;
  requestKey?: string;
};

export function assignmentIdentityPredicate(assignmentId: string, sourceRecordId: string) {
  return and(
    eq(actSourceAssignments.id, assignmentId),
    eq(actSourceAssignments.sourceRecordId, sourceRecordId),
  );
}

function validateCommon(input: { sourceRecordId: string; assignedBy?: string; supersededBy?: string }) {
  if (!input.sourceRecordId.trim() || (input.assignedBy !== undefined && !input.assignedBy.trim()) || (input.supersededBy !== undefined && !input.supersededBy.trim())) throw new AssignmentValidationError();
}

/** Durable owner-controlled parent assignments. Never physically deletes a row. */
export class DrizzleActSourceAssignmentRepository {
  private readonly requestResults = new Map<string, AssignmentRow>();
  private readonly supersessionResults = new Map<string, AssignmentRow>();

  constructor(private readonly database: DrizzleDatabase) {}

  async listActive(sourceRecordId: string): Promise<AssignmentRow[]> {
    if (!sourceRecordId.trim()) throw new AssignmentValidationError();
    return this.database.select().from(actSourceAssignments).where(and(eq(actSourceAssignments.sourceRecordId, sourceRecordId), isNull(actSourceAssignments.supersededAt)));
  }

  async assign(input: AssignSourceParentInput): Promise<AssignmentRow> {
    validateCommon(input);
    if (!targetTypes.has(input.targetEntityType) || !input.targetEntityId.trim()) throw new AssignmentValidationError();
    if (input.requestKey) {
      const prior = this.requestResults.get(input.requestKey);
      if (prior) return prior;
    }
    try {
      const result = await this.database.transaction(async (transaction) => {
        const [source] = await transaction.select({ latestVersionId: actSourceRecords.latestVersionId }).from(actSourceRecords).where(eq(actSourceRecords.id, input.sourceRecordId)).limit(1).for("update");
        if (!source) throw new AssignmentValidationError();
        const [identity] = await transaction.select({ streamType: actSourceRecords.streamType }).from(actSourceRecords).where(eq(actSourceRecords.id, input.sourceRecordId)).limit(1);
        if (!identity || sourceTargetType.get(identity.streamType) !== input.targetEntityType) throw new AssignmentValidationError();
        if (input.expectedSourceVersionId !== undefined && input.expectedSourceVersionId !== source.latestVersionId) throw new AssignmentVersionConflictError();
        const [existing] = await transaction.select().from(actSourceAssignments).where(and(eq(actSourceAssignments.sourceRecordId, input.sourceRecordId), eq(actSourceAssignments.targetEntityType, input.targetEntityType), eq(actSourceAssignments.targetEntityId, input.targetEntityId))).limit(1).for("update");
        if (existing) {
          if (existing.sourceVersionId !== (input.sourceVersionId ?? source.latestVersionId) && existing.supersededAt === null && input.expectedSourceVersionId !== undefined) throw new AssignmentVersionConflictError();
          const [updated] = await transaction.update(actSourceAssignments).set({ role: input.role ?? existing.role, isPrimary: input.isPrimary ?? existing.isPrimary, manualAuthority: true, assignedBy: input.assignedBy.trim(), sourceVersionId: input.sourceVersionId ?? source.latestVersionId, supersededAt: null, supersededBy: null, updatedAt: new Date() }).where(eq(actSourceAssignments.id, existing.id)).returning();
          if (!updated) throw new AssignmentRepositoryError();
          return updated;
        }
        const [created] = await transaction.insert(actSourceAssignments).values({ sourceRecordId: input.sourceRecordId, targetEntityType: input.targetEntityType, targetEntityId: input.targetEntityId, role: input.role?.trim() || "primary", isPrimary: input.isPrimary ?? false, manualAuthority: true, assignedBy: input.assignedBy.trim(), sourceVersionId: input.sourceVersionId ?? source.latestVersionId }).returning();
        if (!created) throw new AssignmentRepositoryError();
        return created;
      });
      if (input.requestKey) this.requestResults.set(input.requestKey, result);
      return result;
    } catch (error) {
      if (error instanceof AssignmentValidationError || error instanceof AssignmentVersionConflictError || error instanceof AssignmentRepositoryError) throw error;
      throw new AssignmentRepositoryError();
    }
  }

  async supersede(input: SupersedeSourceAssignmentInput): Promise<AssignmentRow> {
    if (!input.assignmentId.trim() || !input.sourceRecordId.trim() || !input.supersededBy.trim()) throw new AssignmentValidationError();
    if (input.requestKey) {
      const prior = this.supersessionResults.get(input.requestKey);
      if (prior) return prior;
    }
    try {
      const result = await this.database.transaction(async (transaction) => {
        // Lock in the same source → assignment order as assign(), avoiding a
        // deadlock when an owner supersedes while organization work is running.
        const [source] = await transaction.select({ latestVersionId: actSourceRecords.latestVersionId }).from(actSourceRecords).where(eq(actSourceRecords.id, input.sourceRecordId)).limit(1).for("update");
        if (!source) throw new AssignmentValidationError();
        if (input.expectedSourceVersionId !== undefined && input.expectedSourceVersionId !== source.latestVersionId) throw new AssignmentVersionConflictError();
        const [existing] = await transaction.select().from(actSourceAssignments).where(assignmentIdentityPredicate(input.assignmentId, input.sourceRecordId)).limit(1).for("update");
        if (!existing) throw new AssignmentValidationError();
        if (existing.supersededAt !== null) return existing;
        const [updated] = await transaction.update(actSourceAssignments).set({ supersededAt: new Date(), supersededBy: input.supersededBy.trim(), updatedAt: new Date() }).where(assignmentIdentityPredicate(existing.id, input.sourceRecordId)).returning();
        if (!updated) throw new AssignmentRepositoryError();
        return updated;
      });
      if (input.requestKey) this.supersessionResults.set(input.requestKey, result);
      return result;
    } catch (error) {
      if (error instanceof AssignmentValidationError || error instanceof AssignmentVersionConflictError || error instanceof AssignmentRepositoryError) throw error;
      throw new AssignmentRepositoryError();
    }
  }

  delete(input: SupersedeSourceAssignmentInput) { return this.supersede(input); }
}

export type ActSourceAssignment = AssignmentRow;
