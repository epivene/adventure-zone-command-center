import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  bookings,
  contractCoiDrafts,
  contractDrafts,
  contractFiles,
  contractStatusEvents,
  contractTemplates,
  contractVersions,
  organizations,
} from "@/db/schema";
import type { StoredContractDraftValues } from "./contract-draft-service";
import type { ContractReadiness } from "./contract-types";

type Database = typeof database;

function safeFile(row: typeof contractFiles.$inferSelect) {
  const { storageKey: _storageKey, ...safe } = row;
  return safe;
}

export class DrizzleContractQueryRepository {
  constructor(private readonly database: Database) {}

  async listWorkspaceContracts(filters: {
    status?: typeof contractVersions.$inferSelect.status;
    organizationId?: string;
    bookingId?: string;
  } = {}) {
    const conditions = [];
    if (filters.status) conditions.push(eq(contractVersions.status, filters.status));
    if (filters.organizationId) conditions.push(eq(contractVersions.organizationId, filters.organizationId));
    if (filters.bookingId) conditions.push(eq(contractVersions.bookingId, filters.bookingId));
    const rows = await this.database.select({
      version: contractVersions,
      organizationName: organizations.name,
      bookingName: bookings.name,
    }).from(contractVersions)
      .innerJoin(organizations, eq(organizations.id, contractVersions.organizationId))
      .innerJoin(bookings, eq(bookings.id, contractVersions.bookingId))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(contractVersions.updatedAt));
    const files = await this.database.select().from(contractFiles)
      .orderBy(desc(contractFiles.revision));
    return rows.map(({ version, organizationName, bookingName }) => ({
      ...version,
      organizationName,
      bookingName,
      files: files.filter((file) => file.contractVersionId === version.id).map(safeFile),
    }));
  }

  async listOrganization(organizationId: string) {
    const [versions, eligibleBookings, files] = await Promise.all([
      this.database.select().from(contractVersions)
        .where(eq(contractVersions.organizationId, organizationId))
        .orderBy(desc(contractVersions.createdAt)),
      this.database.select({
        id: bookings.id,
        name: bookings.name,
        startsAt: bookings.startsAt,
        status: bookings.status,
        openDraftId: contractDrafts.id,
      }).from(bookings)
        .leftJoin(contractDrafts, and(eq(contractDrafts.bookingId, bookings.id), isNull(contractDrafts.finalizedAt)))
        .where(and(
          eq(bookings.organizationId, organizationId),
          sql`coalesce(${bookings.notes}, '') not like '%[Merged duplicate] Canonical booking:%'`,
        ))
        .orderBy(desc(bookings.startsAt), asc(bookings.name)),
      this.database.select({ file: contractFiles }).from(contractFiles)
        .innerJoin(contractVersions, eq(contractVersions.id, contractFiles.contractVersionId))
        .where(eq(contractVersions.organizationId, organizationId)),
    ]);
    return {
      organizationId,
      contracts: versions.map((version) => ({
        ...version,
        files: files.filter(({ file }) => file.contractVersionId === version.id).map(({ file }) => safeFile(file)),
      })),
      eligibleBookings,
    };
  }

  async listBooking(bookingId: string) {
    const [versions, openDraftRows, files] = await Promise.all([
      this.database.select().from(contractVersions).where(eq(contractVersions.bookingId, bookingId))
        .orderBy(desc(contractVersions.versionNumber)),
      this.database.select().from(contractDrafts).where(and(eq(contractDrafts.bookingId, bookingId), isNull(contractDrafts.finalizedAt))).limit(1),
      this.database.select({ file: contractFiles }).from(contractFiles)
        .innerJoin(contractVersions, eq(contractVersions.id, contractFiles.contractVersionId))
        .where(eq(contractVersions.bookingId, bookingId)),
    ]);
    return {
      bookingId,
      contracts: versions.map((version) => ({ ...version, files: files.filter(({ file }) => file.contractVersionId === version.id).map(({ file }) => safeFile(file)) })),
      openDraft: openDraftRows[0] ?? null,
    };
  }

  async getVersion(versionId: string) {
    const [version] = await this.database.select().from(contractVersions)
      .where(eq(contractVersions.id, versionId)).limit(1);
    if (!version) return null;
    const [files, statusEvents, coiRows] = await Promise.all([
      this.database.select().from(contractFiles).where(eq(contractFiles.contractVersionId, versionId))
        .orderBy(asc(contractFiles.kind), desc(contractFiles.revision)),
      this.database.select().from(contractStatusEvents).where(eq(contractStatusEvents.contractVersionId, versionId))
        .orderBy(asc(contractStatusEvents.createdAt)),
      this.database.select().from(contractCoiDrafts).where(eq(contractCoiDrafts.contractVersionId, versionId)).limit(1),
    ]);
    return { ...version, files: files.map(safeFile), statusEvents, coiDraft: coiRows[0] ?? null };
  }

  async getDraft(draftId: string) {
    const [row] = await this.database.select({
      draft: contractDrafts,
      templateVersion: contractTemplates.version,
    })
      .from(contractDrafts)
      .innerJoin(contractTemplates, eq(contractDrafts.templateId, contractTemplates.id))
      .where(eq(contractDrafts.id, draftId))
      .limit(1);
    if (!row) return null;
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
}
