import { and, eq, isNull, sql } from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  contractDrafts,
  contractTemplates,
  contractVersions,
} from "@/db/schema";

import type {
  ContractDraftRecord,
  ContractDraftRepository,
  ContractSnapshot,
  ContractVersionRecord,
  StoredContractDraftValues,
} from "./contract-draft-service";
import type { ContractReadiness, ContractSigner } from "./contract-types";

type Database = typeof database;

function draftRecord(row: { draft: typeof contractDrafts.$inferSelect; templateVersion: number }): ContractDraftRecord {
  return {
    id: row.draft.id,
    bookingId: row.draft.bookingId,
    organizationId: row.draft.organizationId,
    templateId: row.draft.templateId,
    templateVersion: row.templateVersion,
    arrangement: row.draft.arrangement,
    storedValues: row.draft.values as StoredContractDraftValues,
    validationState: row.draft.validationState as ContractReadiness,
    revision: row.draft.revision,
    predecessorVersionId: row.draft.predecessorVersionId,
    finalizedAt: row.draft.finalizedAt,
  };
}

function versionRecord(row: typeof contractVersions.$inferSelect): ContractVersionRecord {
  return {
    id: row.id,
    bookingId: row.bookingId,
    organizationId: row.organizationId,
    templateId: row.templateId,
    draftId: row.draftId,
    versionNumber: row.versionNumber,
    status: row.status,
    snapshot: row.snapshot as ContractSnapshot,
    renderedLegalText: row.renderedLegalText,
    signerSnapshot: row.signerSnapshot as ContractSigner[],
    predecessorVersionId: row.predecessorVersionId,
    supersedingVersionId: row.supersedingVersionId,
  };
}

export class DrizzleContractRepository implements ContractDraftRepository {
  constructor(private readonly database: Database) {}

  private async draftById(database: Database, draftId: string) {
    const [row] = await database.select({ draft: contractDrafts, templateVersion: contractTemplates.version })
      .from(contractDrafts)
      .innerJoin(contractTemplates, eq(contractDrafts.templateId, contractTemplates.id))
      .where(eq(contractDrafts.id, draftId))
      .limit(1);
    return row ? draftRecord(row) : null;
  }

  async findOpenDraftByBooking(bookingId: string) {
    const [row] = await this.database.select({ draft: contractDrafts, templateVersion: contractTemplates.version })
      .from(contractDrafts)
      .innerJoin(contractTemplates, eq(contractDrafts.templateId, contractTemplates.id))
      .where(and(eq(contractDrafts.bookingId, bookingId), isNull(contractDrafts.finalizedAt)))
      .limit(1);
    return row ? draftRecord(row) : null;
  }

  async createDraft(input: Parameters<ContractDraftRepository["createDraft"]>[0]) {
    const [created] = await this.database.insert(contractDrafts).values({
      bookingId: input.bookingId,
      organizationId: input.organizationId,
      templateId: input.templateId,
      arrangement: null,
      values: input.storedValues,
      validationState: input.validationState,
      revision: 1,
      predecessorVersionId: input.predecessorVersionId,
      lastEditedBy: input.actorId,
      createdAt: input.now,
      updatedAt: input.now,
    }).returning();
    if (!created) throw new Error("CONTRACT_DRAFT_CREATE_FAILED");
    return draftRecord({ draft: created, templateVersion: input.templateVersion });
  }

  async getDraft(draftId: string) {
    return this.draftById(this.database, draftId);
  }

  async saveDraft(input: Parameters<ContractDraftRepository["saveDraft"]>[0]) {
    const [saved] = await this.database.update(contractDrafts).set({
      arrangement: input.arrangement,
      values: input.storedValues,
      validationState: input.validationState,
      revision: input.expectedRevision + 1,
      lastEditedBy: input.actorId,
      updatedAt: input.now,
    }).where(and(
      eq(contractDrafts.id, input.draftId),
      eq(contractDrafts.revision, input.expectedRevision),
      isNull(contractDrafts.finalizedAt),
    )).returning();
    if (saved) {
      const [template] = await this.database.select({ version: contractTemplates.version })
        .from(contractTemplates).where(eq(contractTemplates.id, saved.templateId)).limit(1);
      if (!template) throw new Error("CONTRACT_TEMPLATE_NOT_FOUND");
      return { kind: "saved" as const, draft: draftRecord({ draft: saved, templateVersion: template.version }) };
    }
    const current = await this.getDraft(input.draftId);
    return current ? { kind: "stale" as const, current } : { kind: "not_found" as const };
  }

  async finalizeDraft(input: Parameters<ContractDraftRepository["finalizeDraft"]>[0]) {
    return this.database.transaction(async (transaction) => {
      const [existing] = await transaction.select().from(contractVersions)
        .where(eq(contractVersions.draftId, input.draftId)).limit(1);
      if (existing) return { version: versionRecord(existing), reused: true };

      const [draft] = await transaction.select().from(contractDrafts)
        .where(eq(contractDrafts.id, input.draftId)).for("update").limit(1);
      if (!draft) throw new Error("CONTRACT_DRAFT_NOT_FOUND");
      const [versionCount] = await transaction.select({
        value: sql<number>`coalesce(max(${contractVersions.versionNumber}), 0)`,
      }).from(contractVersions).where(eq(contractVersions.bookingId, draft.bookingId));
      const versionNumber = Number(versionCount?.value ?? 0) + 1;
      const [created] = await transaction.insert(contractVersions).values({
        bookingId: draft.bookingId,
        organizationId: draft.organizationId,
        templateId: draft.templateId,
        draftId: draft.id,
        versionNumber,
        status: "draft",
        snapshot: input.snapshot,
        renderedLegalText: input.renderedLegalText,
        signerSnapshot: input.signerSnapshot,
        predecessorVersionId: draft.predecessorVersionId,
        createdBy: input.actorId,
        createdAt: input.finalizedAt,
        updatedAt: input.finalizedAt,
      }).returning();
      if (!created) throw new Error("CONTRACT_VERSION_CREATE_FAILED");
      await transaction.update(contractDrafts).set({ finalizedAt: input.finalizedAt, updatedAt: input.finalizedAt })
        .where(eq(contractDrafts.id, draft.id));
      if (draft.predecessorVersionId) {
        await transaction.update(contractVersions).set({
          status: "superseded",
          supersedingVersionId: created.id,
          updatedAt: input.finalizedAt,
        }).where(eq(contractVersions.id, draft.predecessorVersionId));
      }
      return { version: versionRecord(created), reused: false };
    });
  }

  async getVersion(versionId: string) {
    const [row] = await this.database.select().from(contractVersions)
      .where(eq(contractVersions.id, versionId)).limit(1);
    return row ? versionRecord(row) : null;
  }

  async markReadyForAdobe(versionId: string, _actorId: string, now: Date) {
    const [updated] = await this.database.update(contractVersions).set({
      status: "ready_for_adobe",
      updatedAt: now,
    }).where(and(eq(contractVersions.id, versionId), eq(contractVersions.status, "draft"))).returning();
    if (updated) return versionRecord(updated);
    const existing = await this.getVersion(versionId);
    if (!existing) throw new Error("CONTRACT_VERSION_NOT_FOUND");
    if (existing.status !== "ready_for_adobe") throw new Error("CONTRACT_VERSION_NOT_DRAFT");
    return existing;
  }
}
