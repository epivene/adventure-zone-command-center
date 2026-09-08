import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  bookings,
  contractCoiDrafts,
  contractDrafts,
  contractFiles,
  contractStatusEvents,
  contractVersions,
} from "@/db/schema";

type Database = typeof database;

function safeFile(row: typeof contractFiles.$inferSelect) {
  const { storageKey: _storageKey, ...safe } = row;
  return safe;
}

export class DrizzleContractQueryRepository {
  constructor(private readonly database: Database) {}

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
    const [draft] = await this.database.select().from(contractDrafts)
      .where(eq(contractDrafts.id, draftId)).limit(1);
    return draft ?? null;
  }
}
