import { and, eq, sql } from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  actContactSyncStates,
  actExternalLinks,
  actSyncOperations,
  actSyncRuns,
  auditEntries,
  contacts,
  organizations,
} from "@/db/schema";
import { canonicalContactSnapshot } from "@/features/act-sync/contact-snapshot";
import type { RemoteActContact } from "@/features/act-sync/act-types";
import { recordAuditEntry } from "@/features/audit/audit-service";
import {
  syncComparisonCategories,
  type LocalSyncContact,
  type SyncComparisonCategory,
  type SyncComparisonRow,
  type SyncDecision,
} from "@/features/act-sync/sync-comparison";

type DrizzleDatabase = typeof database;
type OrganizationWriter = Pick<DrizzleDatabase, "select" | "insert">;
type SyncWriter = Pick<DrizzleDatabase, "select" | "insert" | "update">;

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

export type ApplyOperationStatus =
  | "pending"
  | "applying"
  | "completed"
  | "failed"
  | "skipped";

export type ApplyOperation = {
  runId: string;
  rowId: string;
  status: ApplyOperationStatus;
  decision: SyncDecision | null;
  actRecordId: string | null;
  error: string | null;
};

export type ApplyOperationResult = {
  status: Extract<ApplyOperationStatus, "completed" | "failed" | "skipped">;
  error: string | null;
};

export interface SyncApplyRepository extends SyncRepository {
  claimOperation(
    runId: string,
    rowId: string,
    decision: SyncDecision,
  ): Promise<"claimed" | "finished" | "in_progress" | "missing">;
  getOperation(runId: string, rowId: string): Promise<ApplyOperation | null>;
  rememberCreatedActId(
    runId: string,
    rowId: string,
    actRecordId: string,
  ): Promise<void>;
  pullContact(
    row: SyncComparisonRow,
    remote: RemoteActContact,
  ): Promise<string>;
  completePush(
    row: SyncComparisonRow,
    remote: RemoteActContact,
  ): Promise<void>;
  linkContact(
    localContactId: string,
    remote: RemoteActContact,
  ): Promise<void>;
  finishOperation(
    runId: string,
    rowId: string,
    result: ApplyOperationResult,
  ): Promise<void>;
  finishRun(runId: string): Promise<void>;
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

export class DrizzleSyncRepository implements SyncApplyRepository {
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

  async claimOperation(
    runId: string,
    rowId: string,
    decision: SyncDecision,
  ) {
    return this.database.transaction(async (transaction) => {
      const [operation] = await transaction
        .select()
        .from(actSyncOperations)
        .where(
          and(
            eq(actSyncOperations.runId, runId),
            eq(actSyncOperations.rowKey, rowId),
          ),
        )
        .limit(1)
        .for("update");
      if (!operation) return "missing" as const;
      if (operation.status === "completed" || operation.status === "skipped") {
        return "finished" as const;
      }
      if (operation.status === "applying") return "in_progress" as const;
      await transaction
        .update(actSyncOperations)
        .set({
          decision,
          status: "applying",
          error: null,
          updatedAt: new Date(),
        })
        .where(eq(actSyncOperations.id, operation.id));
      await transaction
        .update(actSyncRuns)
        .set({ status: "applying" })
        .where(eq(actSyncRuns.id, runId));
      return "claimed" as const;
    });
  }

  async getOperation(
    runId: string,
    rowId: string,
  ): Promise<ApplyOperation | null> {
    const [operation] = await this.database
      .select()
      .from(actSyncOperations)
      .where(
        and(
          eq(actSyncOperations.runId, runId),
          eq(actSyncOperations.rowKey, rowId),
        ),
      )
      .limit(1);
    if (!operation) return null;
    return {
      runId: operation.runId,
      rowId: operation.rowKey,
      status: operation.status as ApplyOperationStatus,
      decision: operation.decision as SyncDecision | null,
      actRecordId: operation.actRecordId,
      error: operation.error,
    };
  }

  async rememberCreatedActId(
    runId: string,
    rowId: string,
    actRecordId: string,
  ) {
    await this.database
      .update(actSyncOperations)
      .set({ actRecordId, updatedAt: new Date() })
      .where(
        and(
          eq(actSyncOperations.runId, runId),
          eq(actSyncOperations.rowKey, rowId),
          eq(actSyncOperations.status, "applying"),
        ),
      );
  }

  async pullContact(row: SyncComparisonRow, remote: RemoteActContact) {
    return this.database.transaction(async (transaction) => {
      const now = new Date();
      const organizationId = await this.resolveOrganizationId(
        transaction,
        remote.organizationName,
        now,
      );
      let localContactId = row.localContactId;
      let before: Record<string, unknown> | null = null;
      if (localContactId) {
        const [current] = await transaction
          .select({ contact: contacts, organizationName: organizations.name })
          .from(contacts)
          .leftJoin(
            organizations,
            eq(contacts.organizationId, organizations.id),
          )
          .where(eq(contacts.id, localContactId))
          .limit(1)
          .for("update", { of: contacts });
        if (!current) throw new Error("Local contact is missing.");
        before = canonicalContactSnapshot({
          firstName: current.contact.firstName,
          lastName: current.contact.lastName,
          organizationName: current.organizationName,
          jobTitle: current.contact.jobTitle,
          email: current.contact.email,
          phone: current.contact.phone,
          address1: current.contact.address1,
          address2: current.contact.address2,
          city: current.contact.city,
          region: current.contact.region,
          postalCode: current.contact.postalCode,
        });
        await transaction
          .update(contacts)
          .set({
            organizationId,
            ...this.contactValues(remote),
            actRecordId: remote.id,
            updatedAt: now,
          })
          .where(eq(contacts.id, localContactId));
      } else {
        const [created] = await transaction
          .insert(contacts)
          .values({
            organizationId,
            ...this.contactValues(remote),
            actRecordId: remote.id,
            createdAt: now,
            updatedAt: now,
          })
          .returning({ id: contacts.id });
        if (!created) throw new Error("Could not create pulled contact.");
        localContactId = created.id;
      }

      await this.ensureExternalLink(
        transaction,
        localContactId,
        remote.id,
      );
      await this.storeSyncedState(
        transaction,
        localContactId,
        remote,
        now,
      );
      await recordAuditEntry(transaction, {
        entityType: "contact",
        entityId: localContactId,
        action: before ? "act_sync_pulled_update" : "act_sync_pulled_create",
        before,
        after: canonicalContactSnapshot(remote),
      });
      return localContactId;
    });
  }

  async completePush(row: SyncComparisonRow, remote: RemoteActContact) {
    if (!row.localContactId) throw new Error("Local contact is missing.");
    await this.database.transaction(async (transaction) => {
      const [current] = await transaction
        .select()
        .from(contacts)
        .where(eq(contacts.id, row.localContactId!))
        .limit(1)
        .for("update");
      if (!current) throw new Error("Local contact is missing.");
      const now = new Date();
      await this.ensureExternalLink(
        transaction,
        current.id,
        remote.id,
      );
      await transaction
        .update(contacts)
        .set({ actRecordId: remote.id, updatedAt: now })
        .where(eq(contacts.id, current.id));
      await this.storeSyncedState(
        transaction,
        current.id,
        remote,
        now,
      );
      await recordAuditEntry(transaction, {
        entityType: "contact",
        entityId: current.id,
        action: "act_sync_pushed",
        before: row.baseSnapshot,
        after: canonicalContactSnapshot(remote),
      });
    });
  }

  async linkContact(
    localContactId: string,
    remote: RemoteActContact,
  ) {
    await this.database.transaction(async (transaction) => {
      const [current] = await transaction
        .select({ id: contacts.id })
        .from(contacts)
        .where(eq(contacts.id, localContactId))
        .limit(1)
        .for("update");
      if (!current) throw new Error("Local contact is missing.");
      const now = new Date();
      await this.ensureExternalLink(
        transaction,
        localContactId,
        remote.id,
      );
      await transaction
        .update(contacts)
        .set({ actRecordId: remote.id, updatedAt: now })
        .where(eq(contacts.id, localContactId));
      await transaction
        .insert(actContactSyncStates)
        .values({
          contactId: localContactId,
          baseSnapshot: null,
          actEditedAt: this.editedDate(remote),
          lastSyncedAt: null,
          localDirty: true,
          state: "conflict",
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: actContactSyncStates.contactId,
          set: {
            baseSnapshot: null,
            actEditedAt: this.editedDate(remote),
            localDirty: true,
            state: "conflict",
            updatedAt: now,
          },
        });
      await recordAuditEntry(transaction, {
        entityType: "contact",
        entityId: localContactId,
        action: "act_sync_linked",
        before: null,
        after: { actRecordId: remote.id },
      });
    });
  }

  async finishOperation(
    runId: string,
    rowId: string,
    result: ApplyOperationResult,
  ) {
    await this.database
      .update(actSyncOperations)
      .set({
        status: result.status,
        error: result.error,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(actSyncOperations.runId, runId),
          eq(actSyncOperations.rowKey, rowId),
        ),
      );
  }

  async finishRun(runId: string) {
    const operations = await this.database
      .select({ status: actSyncOperations.status })
      .from(actSyncOperations)
      .where(eq(actSyncOperations.runId, runId));
    if (
      operations.some(
        ({ status }) => status === "pending" || status === "applying",
      )
    ) {
      return;
    }
    const failed = operations.some(({ status }) => status === "failed");
    await this.database
      .update(actSyncRuns)
      .set({
        status: failed ? "failed" : "completed",
        completedAt: new Date(),
      })
      .where(eq(actSyncRuns.id, runId));
  }

  private contactValues(remote: RemoteActContact) {
    return {
      firstName: remote.firstName,
      lastName: remote.lastName,
      jobTitle: remote.jobTitle,
      email: remote.email,
      phone: remote.phone,
      address1: remote.address1,
      address2: remote.address2,
      city: remote.city,
      region: remote.region,
      postalCode: remote.postalCode,
    };
  }

  private editedDate(remote: RemoteActContact) {
    if (!remote.editedAt) return null;
    const date = new Date(remote.editedAt);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private async resolveOrganizationId(
    writer: OrganizationWriter,
    organizationName: string | null,
    now: Date,
  ) {
    if (!organizationName) return null;
    const normalized = organizationName
      .trim()
      .toLocaleLowerCase("en-US")
      .replace(/\s+/g, " ");
    const [existing] = await writer
      .select({ id: organizations.id })
      .from(organizations)
      .where(
        sql`lower(regexp_replace(trim(${organizations.name}), '\\s+', ' ', 'g')) = ${normalized}`,
      )
      .limit(1);
    if (existing) return existing.id;
    const [created] = await writer
      .insert(organizations)
      .values({
        name: organizationName,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: organizations.id });
    if (!created) throw new Error("Could not create contact organization.");
    return created.id;
  }

  private async ensureExternalLink(
    writer: SyncWriter,
    contactId: string,
    actRecordId: string,
  ) {
    const [created] = await writer
      .insert(actExternalLinks)
      .values({
        entityType: "contact",
        entityId: contactId,
        actRecordId,
      })
      .onConflictDoNothing({
        target: [actExternalLinks.entityType, actExternalLinks.actRecordId],
      })
      .returning({ entityId: actExternalLinks.entityId });
    if (created) return;
    const [existing] = await writer
      .select({ entityId: actExternalLinks.entityId })
      .from(actExternalLinks)
      .where(
        and(
          eq(actExternalLinks.entityType, "contact"),
          eq(actExternalLinks.actRecordId, actRecordId),
        ),
      )
      .limit(1);
    if (existing?.entityId !== contactId) {
      throw new Error("Act! record is already linked to another contact.");
    }
  }

  private async storeSyncedState(
    writer: SyncWriter,
    contactId: string,
    remote: RemoteActContact,
    now: Date,
  ) {
    await writer
      .insert(actContactSyncStates)
      .values({
        contactId,
        baseSnapshot: canonicalContactSnapshot(remote),
        actEditedAt: this.editedDate(remote),
        lastSyncedAt: now,
        localDirty: false,
        state: "synced",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: actContactSyncStates.contactId,
        set: {
          baseSnapshot: canonicalContactSnapshot(remote),
          actEditedAt: this.editedDate(remote),
          lastSyncedAt: now,
          localDirty: false,
          state: "synced",
          updatedAt: now,
        },
      });
  }

  async listSyncAuditEntries(contactId: string) {
    return this.database
      .select()
      .from(auditEntries)
      .where(
        and(
          eq(auditEntries.entityType, "contact"),
          eq(auditEntries.entityId, contactId),
        ),
      );
  }
}
