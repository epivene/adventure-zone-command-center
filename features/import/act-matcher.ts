import { and, eq, sql } from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  actExternalLinks,
  actImportRuns,
  contacts,
  organizations,
} from "@/db/schema";
import type {
  ActCsvRecord,
  ImportApplyFailure,
  ImportApplyResult,
  ImportAuditEntry,
  ImportFieldChange,
  ImportPreview,
  ImportPreviewRow,
  ImportRun,
  ImportSummary,
  LocalContact,
} from "@/features/import/act-types";
import { recordAuditEntry } from "@/features/audit/audit-service";
import { normalizeNorthAmericanPhone } from "@/features/contacts/phone-normalization";

export interface ActImportTransaction {
  createContact(record: ActCsvRecord): Promise<LocalContact>;
  updateContact(
    contactId: string,
    record: ActCsvRecord,
    expected: LocalContact,
  ): Promise<LocalContact>;
  ensureExternalLink(
    externalId: string,
    contactId: string,
    importRunId: string,
  ): Promise<"linked" | "already_owned" | "conflict">;
  createAuditEntry(entry: ImportAuditEntry): Promise<void>;
  completeImportRun(
    runId: string,
    appliedRowIds: readonly string[],
  ): Promise<void>;
}

export interface ActImportRepository {
  findByExternalId(externalId: string): Promise<LocalContact[]>;
  findByEmail(normalizedEmail: string): Promise<LocalContact[]>;
  findByOrganizationAndContact(
    normalizedOrganization: string,
    normalizedContact: string,
  ): Promise<LocalContact[]>;
  createPreviewRun(
    sourceFileName: string,
    rows: readonly ImportPreviewRow[],
  ): Promise<ImportRun>;
  getImportRun(runId: string): Promise<ImportRun | null>;
  transaction<T>(
    operation: (transaction: ActImportTransaction) => Promise<T>,
  ): Promise<T>;
}

type ImportOptions = {
  repository?: ActImportRepository;
  sourceFileName?: string;
};

function normalize(value: string) {
  return value.trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}

function displayValue(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function comparable(value: string | null) {
  return value === null ? null : normalize(value);
}

function formatCsvRows(rowNumbers: readonly number[]) {
  const labels = rowNumbers.map(String);
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
}

type IndexedRecord = {
  index: number;
  record: ActCsvRecord;
};

function repeatedGroups(
  records: readonly IndexedRecord[],
  keyFor: (record: ActCsvRecord) => string | null,
) {
  const groups = new Map<string, IndexedRecord[]>();
  for (const indexedRecord of records) {
    const key = keyFor(indexedRecord.record);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(indexedRecord);
    groups.set(key, group);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

function fileCollisionMessages(records: readonly ActCsvRecord[]) {
  const messagesByIndex = new Map<number, string[]>();
  const validRecords = records
    .map((record, index) => ({ index, record }))
    .filter(({ record }) => record.validationErrors.length === 0);

  const markGroup = (
    group: readonly IndexedRecord[],
    message: string,
  ) => {
    for (const { index } of group) {
      messagesByIndex.set(index, [
        ...(messagesByIndex.get(index) ?? []),
        message,
      ]);
    }
  };

  for (const group of repeatedGroups(validRecords, ({ recordId }) =>
    recordId ? normalize(recordId) : null,
  )) {
    const rowNumbers = group.map(({ record }) => record.rowNumber);
    markGroup(
      group,
      `CSV rows ${formatCsvRows(rowNumbers)} share the Act! record ID ${displayValue(group[0]!.record.recordId!)}.`,
    );
  }

  const recordsWithoutCollisions = () =>
    validRecords.filter(({ index }) => !messagesByIndex.has(index));

  for (const group of repeatedGroups(
    recordsWithoutCollisions(),
    ({ email }) => (email ? normalize(email) : null),
  )) {
    const stableIds = group.map(({ record }) => record.recordId).filter(Boolean);
    const everyRowHasDistinctStableId =
      stableIds.length === group.length &&
      new Set(stableIds.map((recordId) => normalize(recordId!))).size ===
        group.length;
    if (everyRowHasDistinctStableId) continue;

    const rowNumbers = group.map(({ record }) => record.rowNumber);
    markGroup(
      group,
      `CSV rows ${formatCsvRows(rowNumbers)} share the email ${normalize(group[0]!.record.email!)}.`,
    );
  }

  for (const group of repeatedGroups(
    recordsWithoutCollisions().filter(
      ({ record }) => !record.recordId && !record.email,
    ),
    ({ company, contact }) =>
      company ? `${normalize(company)}\u0000${normalize(contact)}` : null,
  )) {
    const rowNumbers = group.map(({ record }) => record.rowNumber);
    const first = group[0]!.record;
    markGroup(
      group,
      `CSV rows ${formatCsvRows(rowNumbers)} share the organization and contact ${displayValue(first.company!)} / ${displayValue(first.contact)}.`,
    );
  }

  return messagesByIndex;
}

function fileCollisionRow(
  record: ActCsvRecord,
  messages: readonly string[],
): ImportPreviewRow {
  return {
    rowId: `row-${record.rowNumber}`,
    record,
    category: "conflict",
    matchReason: "none",
    localContactId: null,
    localContact: null,
    candidateContactIds: [],
    changes: [],
    messages: [...messages],
  };
}

function changesFor(
  record: ActCsvRecord,
  localContact: LocalContact,
): ImportFieldChange[] {
  const candidates: ImportFieldChange[] = [
    {
      field: "company",
      before: localContact.organizationName,
      after: record.company,
    },
    {
      field: "contact",
      before: localContact.contactName,
      after: record.contact,
    },
    {
      field: "email",
      before: localContact.email,
      after: record.email,
    },
    {
      field: "phone",
      before: localContact.phone,
      after: record.phone,
    },
  ];

  return candidates.filter((change) => {
    if (change.field === "phone") {
      return (change.before?.trim() ?? null) !== (change.after?.trim() ?? null);
    }
    return comparable(change.before) !== comparable(change.after);
  });
}

function matchedRow(
  record: ActCsvRecord,
  reason: ImportPreviewRow["matchReason"],
  candidates: LocalContact[],
): ImportPreviewRow {
  const rowId = `row-${record.rowNumber}`;
  if (candidates.length > 1) {
    return {
      rowId,
      record,
      category: "conflict",
      matchReason: reason,
      localContactId: null,
      localContact: null,
      candidateContactIds: candidates.map((candidate) => candidate.id),
      changes: [],
      messages: [
        `Multiple local contacts match by ${reason.replaceAll("_", " ")}.`,
      ],
    };
  }

  const [localContact] = candidates;
  if (!localContact) {
    throw new Error("matchedRow requires at least one candidate.");
  }
  const changes = changesFor(record, localContact);
  return {
    rowId,
    record,
    category: changes.length === 0 ? "duplicate" : "change",
    matchReason: reason,
    localContactId: localContact.id,
    localContact,
    candidateContactIds: [localContact.id],
    changes,
    messages:
      changes.length === 0
        ? ["This row already matches the local contact."]
        : [],
  };
}

async function classifyRecord(
  record: ActCsvRecord,
  repository: ActImportRepository,
): Promise<ImportPreviewRow> {
  const rowId = `row-${record.rowNumber}`;
  if (record.validationErrors.length > 0) {
    return {
      rowId,
      record,
      category: "error",
      matchReason: "none",
      localContactId: null,
      localContact: null,
      candidateContactIds: [],
      changes: [],
      messages: [...record.validationErrors],
    };
  }

  if (record.recordId) {
    const externalMatches = await repository.findByExternalId(record.recordId);
    if (externalMatches.length > 0) {
      return matchedRow(record, "external_id", externalMatches);
    }
  }

  if (record.email) {
    const emailMatches = await repository.findByEmail(normalize(record.email));
    if (emailMatches.length > 0) {
      return matchedRow(record, "email", emailMatches);
    }
  }

  if (record.company) {
    const organizationMatches =
      await repository.findByOrganizationAndContact(
        normalize(record.company),
        normalize(record.contact),
      );
    if (organizationMatches.length > 0) {
      return matchedRow(
        record,
        "organization_contact",
        organizationMatches,
      );
    }
  }

  return {
    rowId,
    record,
    category: "new",
    matchReason: "none",
    localContactId: null,
    localContact: null,
    candidateContactIds: [],
    changes: [],
    messages: [],
  };
}

function summarize(rows: readonly ImportPreviewRow[]): ImportSummary {
  const summary: ImportSummary = {
    new: 0,
    change: 0,
    duplicate: 0,
    conflict: 0,
    error: 0,
  };
  rows.forEach((row) => {
    summary[row.category] += 1;
  });
  return summary;
}

async function defaultRepository(): Promise<ActImportRepository> {
  const { db } = await import("@/db/client");
  return new DrizzleActImportRepository(db);
}

export async function previewActImport(
  records: readonly ActCsvRecord[],
  options: ImportOptions = {},
): Promise<ImportPreview> {
  const repository = options.repository ?? (await defaultRepository());
  const rows: ImportPreviewRow[] = [];
  const collisionMessages = fileCollisionMessages(records);
  for (const [index, record] of records.entries()) {
    const messages = collisionMessages.get(index);
    rows.push(
      messages
        ? fileCollisionRow(record, messages)
        : await classifyRecord(record, repository),
    );
  }

  const run = await repository.createPreviewRun(
    options.sourceFileName ?? "act-contacts.csv",
    rows,
  );
  return {
    runId: run.id,
    sourceFileName: run.sourceFileName,
    rows,
    summary: summarize(rows),
  };
}

function unsafeFailure(row: ImportPreviewRow): ImportApplyFailure | null {
  if (row.category === "conflict") {
    return {
      rowId: row.rowId,
      message: "Conflict rows cannot be applied automatically.",
    };
  }
  if (row.category === "error") {
    return {
      rowId: row.rowId,
      message: "Rows with validation errors cannot be applied.",
    };
  }
  if (row.category === "duplicate") {
    return {
      rowId: row.rowId,
      message: "Duplicate rows do not need to be applied.",
    };
  }
  if (
    row.category === "change" &&
    (!row.localContactId || !row.localContact)
  ) {
    return {
      rowId: row.rowId,
      message: "Stored change proposal is incomplete.",
    };
  }
  return null;
}

function auditSnapshot(contact: LocalContact) {
  return {
    organizationName: contact.organizationName,
    contactName: contact.contactName,
    email: contact.email,
    phone: contact.phone,
  };
}

class ActImportRowConflictError extends Error {
  constructor(
    readonly rowId: string,
    message: string,
  ) {
    super(message);
    this.name = "ActImportRowConflictError";
  }
}

function isContactConflict(error: unknown) {
  return (
    error instanceof Error &&
    error.name === "ActImportContactConflictError"
  );
}

export async function applyActImport(
  runId: string,
  approvedRowIds: readonly string[],
  options: Pick<ImportOptions, "repository"> = {},
): Promise<ImportApplyResult> {
  const repository = options.repository ?? (await defaultRepository());
  const run = await repository.getImportRun(runId);
  if (!run) throw new Error("Import run was not found.");
  if (run.status !== "previewed") {
    throw new Error("Import run has already been applied.");
  }

  const requestedIds = [...new Set(approvedRowIds)];
  const rowsById = new Map(run.rows.map((row) => [row.rowId, row]));
  const failedRows: ImportApplyFailure[] = [];
  const safeRows: ImportPreviewRow[] = [];
  for (const rowId of requestedIds) {
    const row = rowsById.get(rowId);
    if (!row) {
      failedRows.push({
        rowId,
        message: "Row does not belong to this import run.",
      });
      continue;
    }
    const failure = unsafeFailure(row);
    if (failure) {
      failedRows.push(failure);
    } else {
      safeRows.push(row);
    }
  }

  const appliedRowIds: string[] = [];
  if (safeRows.length > 0) {
    const transactionAppliedRowIds: string[] = [];
    try {
      await repository.transaction(async (transaction) => {
        for (const row of safeRows) {
          const before = row.localContact
            ? auditSnapshot(row.localContact)
            : null;
          let updated: LocalContact;
          try {
            updated =
              row.category === "new"
                ? await transaction.createContact(row.record)
                : await transaction.updateContact(
                    row.localContactId!,
                    row.record,
                    row.localContact!,
                  );
          } catch (error) {
            if (isContactConflict(error)) {
              throw new ActImportRowConflictError(
                row.rowId,
                "Contact changed after the import preview.",
              );
            }
            throw error;
          }

          if (row.record.recordId) {
            const claim = await transaction.ensureExternalLink(
              row.record.recordId,
              updated.id,
              runId,
            );
            if (claim === "conflict") {
              throw new ActImportRowConflictError(
                row.rowId,
                "Act record is already linked to another local contact.",
              );
            }
          }
          await transaction.createAuditEntry({
            entityType: "contact",
            entityId: updated.id,
            action:
              row.category === "new"
                ? "act_import_created"
                : "act_import_updated",
            before,
            after: auditSnapshot(updated),
          });
          transactionAppliedRowIds.push(row.rowId);
        }
        await transaction.completeImportRun(runId, transactionAppliedRowIds);
      });
      appliedRowIds.push(...transactionAppliedRowIds);
    } catch (error) {
      if (!(error instanceof ActImportRowConflictError)) throw error;
      for (const row of safeRows) {
        failedRows.push({
          rowId: row.rowId,
          message:
            row.rowId === error.rowId
              ? error.message
              : "Import batch was rolled back because another approved row conflicted.",
        });
      }
    }
  }

  const requestedSet = new Set(requestedIds);
  return {
    runId,
    appliedRowIds,
    skippedRowIds: run.rows
      .filter((row) => !requestedSet.has(row.rowId))
      .map((row) => row.rowId),
    failedRows,
  };
}

type DrizzleDatabase = typeof database;

function toLocalContact(record: {
  contact: typeof contacts.$inferSelect;
  organization: typeof organizations.$inferSelect | null;
}): LocalContact {
  return {
    id: record.contact.id,
    organizationId: record.contact.organizationId,
    organizationName: record.organization?.name ?? null,
    contactName: `${record.contact.firstName} ${record.contact.lastName}`.trim(),
    email: record.contact.email,
    phone: record.contact.phone,
  };
}

function splitContactName(contactName: string) {
  const parts = contactName.trim().split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0] as string, lastName: "" };
  }
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts.at(-1) as string,
  };
}

class DrizzleActImportTransaction implements ActImportTransaction {
  constructor(private readonly database: DrizzleDatabase) {}

  async createContact(record: ActCsvRecord): Promise<LocalContact> {
    let organization: typeof organizations.$inferSelect | null = null;
    if (record.company) {
      const [createdOrganization] = await this.database
        .insert(organizations)
        .values({ name: record.company })
        .returning();
      if (!createdOrganization) {
        throw new Error("Could not create imported organization.");
      }
      organization = createdOrganization;
    }
    const [created] = await this.database
      .insert(contacts)
      .values({
        organizationId: organization?.id ?? null,
        ...splitContactName(record.contact),
        email: record.email,
        phone: record.phone,
        normalizedPhone: record.phone
          ? normalizeNorthAmericanPhone(record.phone)
          : null,
      })
      .returning();
    if (!created) throw new Error("Could not create imported contact.");
    return toLocalContact({ contact: created, organization });
  }

  async updateContact(
    contactId: string,
    record: ActCsvRecord,
    expected: LocalContact,
  ): Promise<LocalContact> {
    const [current] = await this.database
      .select({ contact: contacts, organization: organizations })
      .from(contacts)
      .leftJoin(
        organizations,
        eq(contacts.organizationId, organizations.id),
      )
      .where(eq(contacts.id, contactId))
      .limit(1)
      .for("update", { of: contacts });
    if (!current) throw new Error("Contact disappeared during import.");
    const currentContact = toLocalContact(current);
    if (
      JSON.stringify(auditSnapshot(currentContact)) !==
      JSON.stringify(auditSnapshot(expected))
    ) {
      const error = new Error("Contact changed after the import preview.");
      error.name = "ActImportContactConflictError";
      throw error;
    }

    let organization = current.organization;
    if (!record.company) {
      organization = null;
    } else if (
      !organization ||
      normalize(organization.name) !== normalize(record.company)
    ) {
      const [createdOrganization] = await this.database
        .insert(organizations)
        .values({ name: record.company })
        .returning();
      if (!createdOrganization) {
        throw new Error("Could not create imported organization.");
      }
      organization = createdOrganization;
    }

    const [updated] = await this.database
      .update(contacts)
      .set({
        organizationId: organization?.id ?? null,
        ...splitContactName(record.contact),
        email: record.email,
        phone: record.phone,
        normalizedPhone: record.phone
          ? normalizeNorthAmericanPhone(record.phone)
          : null,
        updatedAt: new Date(),
      })
      .where(eq(contacts.id, contactId))
      .returning();
    if (!updated) throw new Error("Could not update imported contact.");
    return toLocalContact({ contact: updated, organization });
  }

  async ensureExternalLink(
    externalId: string,
    contactId: string,
    importRunId: string,
  ) {
    const [created] = await this.database
      .insert(actExternalLinks)
      .values({
        entityType: "contact",
        entityId: contactId,
        actRecordId: externalId,
        importRunId,
      })
      .onConflictDoNothing({
        target: [actExternalLinks.entityType, actExternalLinks.actRecordId],
      })
      .returning({ entityId: actExternalLinks.entityId });
    if (created) return "linked" as const;

    const [existing] = await this.database
      .select({
        entityType: actExternalLinks.entityType,
        entityId: actExternalLinks.entityId,
      })
      .from(actExternalLinks)
      .where(
        and(
          eq(actExternalLinks.entityType, "contact"),
          eq(actExternalLinks.actRecordId, externalId),
        ),
      )
      .limit(1);
    return existing?.entityId === contactId
      ? ("already_owned" as const)
      : ("conflict" as const);
  }

  async createAuditEntry(entry: ImportAuditEntry) {
    await recordAuditEntry(this.database, entry);
  }

  async completeImportRun(runId: string) {
    const [completed] = await this.database
      .update(actImportRuns)
      .set({ status: "completed", completedAt: new Date() })
      .where(
        and(
          eq(actImportRuns.id, runId),
          eq(actImportRuns.status, "previewed"),
        ),
      )
      .returning({ id: actImportRuns.id });
    if (!completed) {
      throw new Error("Import run has already been applied.");
    }
  }
}

export class DrizzleActImportRepository implements ActImportRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  private async contactsWhere(
    condition: ReturnType<typeof eq> | ReturnType<typeof and>,
  ) {
    const records = await this.database
      .select({ contact: contacts, organization: organizations })
      .from(contacts)
      .leftJoin(
        organizations,
        eq(contacts.organizationId, organizations.id),
      )
      .where(condition);
    return records.map(toLocalContact);
  }

  async findByExternalId(externalId: string) {
    const records = await this.database
      .select({ contact: contacts, organization: organizations })
      .from(actExternalLinks)
      .innerJoin(
        contacts,
        and(
          eq(actExternalLinks.entityType, "contact"),
          eq(actExternalLinks.entityId, contacts.id),
        ),
      )
      .leftJoin(
        organizations,
        eq(contacts.organizationId, organizations.id),
      )
      .where(eq(actExternalLinks.actRecordId, externalId));
    return records.map(toLocalContact);
  }

  findByEmail(normalizedEmail: string) {
    return this.contactsWhere(
      sql`lower(trim(${contacts.email})) = ${normalizedEmail}`,
    );
  }

  findByOrganizationAndContact(
    normalizedOrganization: string,
    normalizedContact: string,
  ) {
    return this.contactsWhere(
      and(
        sql`lower(regexp_replace(trim(${organizations.name}), '\\s+', ' ', 'g')) = ${normalizedOrganization}`,
        sql`lower(regexp_replace(trim(concat_ws(' ', ${contacts.firstName}, ${contacts.lastName})), '\\s+', ' ', 'g')) = ${normalizedContact}`,
      ),
    );
  }

  async createPreviewRun(
    sourceFileName: string,
    rows: readonly ImportPreviewRow[],
  ) {
    const [run] = await this.database
      .insert(actImportRuns)
      .values({
        sourceFileName,
        status: "previewed",
        summary: { rows },
      })
      .returning();
    if (!run) throw new Error("Could not store import preview.");
    return {
      id: run.id,
      sourceFileName: run.sourceFileName,
      status: "previewed" as const,
      rows: structuredClone(rows),
    };
  }

  async getImportRun(runId: string): Promise<ImportRun | null> {
    const [run] = await this.database
      .select()
      .from(actImportRuns)
      .where(eq(actImportRuns.id, runId))
      .limit(1);
    if (!run) return null;
    const rows = run.summary?.rows;
    if (!Array.isArray(rows)) {
      throw new Error("Stored import preview is malformed.");
    }
    if (run.status !== "previewed" && run.status !== "completed") {
      throw new Error("Stored import run has an unsupported status.");
    }
    return {
      id: run.id,
      sourceFileName: run.sourceFileName,
      status: run.status,
      rows: rows as ImportPreviewRow[],
    };
  }

  transaction<T>(
    operation: (transaction: ActImportTransaction) => Promise<T>,
  ) {
    return this.database.transaction((transaction) =>
      operation(
        new DrizzleActImportTransaction(
          transaction as unknown as DrizzleDatabase,
        ),
      ),
    );
  }
}
