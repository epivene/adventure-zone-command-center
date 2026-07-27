import { and, eq } from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  actContactSyncStates,
  actExternalLinks,
  actSyncOperations,
  actSyncRuns,
  contacts,
  organizations,
} from "@/db/schema";
import { canonicalContactSnapshot } from "@/features/act-sync/contact-snapshot";
import {
  syncComparisonCategories,
  type LocalSyncContact,
  type SyncComparisonCategory,
  type SyncComparisonRow,
} from "@/features/act-sync/sync-comparison";

type DrizzleDatabase = typeof database;

export type SyncSummary = Record<SyncComparisonCategory, number>;

export type StoredSyncPreview = {
  id: string;
  status: "previewed" | "applying" | "completed" | "failed";
  rows: SyncComparisonRow[];
  summary: SyncSummary;
  startedAt: Date;
  completedAt: Date | null;
};

export interface SyncRepository {
  listLocalContacts(): Promise<LocalSyncContact[]>;
  createPreview(
    rows: readonly SyncComparisonRow[],
    summary: SyncSummary,
  ): Promise<StoredSyncPreview>;
  getPreview(runId: string): Promise<StoredSyncPreview | null>;
}

function isSnapshot(value: unknown) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSyncSummary(value: unknown): value is SyncSummary {
  if (!isSnapshot(value)) return false;
  return syncComparisonCategories.every(
    (category) =>
      typeof (value as Record<string, unknown>)[category] === "number",
  );
}

function storedSummary(value: unknown) {
  if (!isSnapshot(value)) return null;
  const record = value as Record<string, unknown>;
  if (!isSyncSummary(record.counts) || !Array.isArray(record.rows)) return null;
  return {
    counts: record.counts,
    rows: record.rows as SyncComparisonRow[],
  };
}

export class DrizzleSyncRepository implements SyncRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async listLocalContacts(): Promise<LocalSyncContact[]> {
    const records = await this.database
      .select({
        contact: contacts,
        organizationName: organizations.name,
        externalActRecordId: actExternalLinks.actRecordId,
        baseSnapshot: actContactSyncStates.baseSnapshot,
        actEditedAt: actContactSyncStates.actEditedAt,
      })
      .from(contacts)
      .leftJoin(
        organizations,
        eq(contacts.organizationId, organizations.id),
      )
      .leftJoin(
        actExternalLinks,
        and(
          eq(actExternalLinks.entityType, "contact"),
          eq(actExternalLinks.entityId, contacts.id),
        ),
      )
      .leftJoin(
        actContactSyncStates,
        eq(contacts.id, actContactSyncStates.contactId),
      );

    const contactsById = new Map<string, LocalSyncContact>();
    for (const record of records) {
      const fields = {
        firstName: record.contact.firstName,
        lastName: record.contact.lastName,
        organizationName: record.organizationName,
        jobTitle: record.contact.jobTitle,
        email: record.contact.email,
        phone: record.contact.phone,
        address1: record.contact.address1,
        address2: record.contact.address2,
        city: record.contact.city,
        region: record.contact.region,
        postalCode: record.contact.postalCode,
      };
      const existing = contactsById.get(record.contact.id);
      contactsById.set(record.contact.id, {
        id: record.contact.id,
        actRecordId:
          existing?.actRecordId ??
          record.externalActRecordId ??
          record.contact.actRecordId,
        ...fields,
        baseSnapshot: isSnapshot(record.baseSnapshot)
          ? canonicalContactSnapshot(
              record.baseSnapshot as Parameters<
                typeof canonicalContactSnapshot
              >[0],
            )
          : null,
        actEditedAt:
          record.actEditedAt?.toISOString() ?? existing?.actEditedAt ?? null,
      });
    }
    return [...contactsById.values()];
  }

  async createPreview(
    rows: readonly SyncComparisonRow[],
    summary: SyncSummary,
  ): Promise<StoredSyncPreview> {
    return this.database.transaction(async (transaction) => {
      const [run] = await transaction
        .insert(actSyncRuns)
        .values({
          status: "previewed",
          summary: { counts: summary, rows },
        })
        .returning();
      if (!run) throw new Error("Could not store Act! sync preview.");

      if (rows.length > 0) {
        await transaction.insert(actSyncOperations).values(
          rows.map((row) => ({
            runId: run.id,
            rowKey: row.rowId,
            localContactId: row.localContactId,
            actRecordId: row.actRecordId,
            category: row.category,
            status: "pending",
            baseSnapshot: row.baseSnapshot,
            localSnapshot: row.localSnapshot,
            actSnapshot: row.actSnapshot,
          })),
        );
      }

      return {
        id: run.id,
        status: "previewed",
        rows: structuredClone([...rows]),
        summary: structuredClone(summary),
        startedAt: run.startedAt,
        completedAt: run.completedAt,
      };
    });
  }

  async getPreview(runId: string): Promise<StoredSyncPreview | null> {
    const [run] = await this.database
      .select()
      .from(actSyncRuns)
      .where(eq(actSyncRuns.id, runId))
      .limit(1);
    if (!run) return null;
    const summary = storedSummary(run.summary);
    if (!summary) throw new Error("Stored Act! sync preview is malformed.");
    if (
      run.status !== "previewed" &&
      run.status !== "applying" &&
      run.status !== "completed" &&
      run.status !== "failed"
    ) {
      throw new Error("Stored Act! sync run has an unsupported status.");
    }
    return {
      id: run.id,
      status: run.status,
      rows: structuredClone(summary.rows),
      summary: structuredClone(summary.counts),
      startedAt: run.startedAt,
      completedAt: run.completedAt,
    };
  }
}
