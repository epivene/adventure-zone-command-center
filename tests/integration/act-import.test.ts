import { describe, expect, it } from "vitest";

import {
  applyActImport,
  previewActImport,
  type ActImportRepository,
  type ActImportTransaction,
} from "@/features/import/act-matcher";
import type {
  ActCsvRecord,
  ImportAuditEntry,
  ImportPreviewRow,
  ImportRun,
  LocalContact,
} from "@/features/import/act-types";

const baseRecord: ActCsvRecord = {
  rowNumber: 2,
  recordId: "ACT-001",
  company: "Marias Fair",
  contact: "Avery Example",
  email: "avery@example.com",
  phone: "406-555-0101",
  city: "Shelby",
  region: "MT",
  validationErrors: [],
};

class InMemoryActImportRepository implements ActImportRepository {
  public readonly contacts = new Map<string, LocalContact>();
  public readonly bookings = new Map<string, { id: string }>();
  public readonly externalLinks = new Map<string, string[]>();
  public readonly externalLinkRunIds = new Map<string, string>();
  public readonly importRuns = new Map<string, ImportRun>();
  public readonly auditEntries: ImportAuditEntry[] = [];
  public transactionCount = 0;
  public failAuditWrite = false;
  private transactionTail: Promise<void> = Promise.resolve();
  private nextContactNumber = 10;
  private nextOrganizationNumber = 10;
  private nextRunNumber = 1;

  async findByExternalId(externalId: string) {
    return (this.externalLinks.get(externalId) ?? [])
      .map((contactId) => this.contacts.get(contactId))
      .filter((contact): contact is LocalContact => contact !== undefined)
      .map((contact) => ({ ...contact }));
  }

  async findByEmail(normalizedEmail: string) {
    return [...this.contacts.values()]
      .filter((contact) => contact.email?.trim().toLowerCase() === normalizedEmail)
      .map((contact) => ({ ...contact }));
  }

  async findByOrganizationAndContact(
    normalizedOrganization: string,
    normalizedContact: string,
  ) {
    return [...this.contacts.values()]
      .filter(
        (contact) =>
          contact.organizationName?.trim().toLowerCase() ===
            normalizedOrganization &&
          contact.contactName.trim().toLowerCase() === normalizedContact,
      )
      .map((contact) => ({ ...contact }));
  }

  async createPreviewRun(
    sourceFileName: string,
    rows: readonly ImportPreviewRow[],
  ) {
    const run: ImportRun = {
      id: `run-${this.nextRunNumber++}`,
      sourceFileName,
      status: "previewed",
      rows: structuredClone(rows),
    };
    this.importRuns.set(run.id, run);
    return structuredClone(run);
  }

  async getImportRun(runId: string) {
    const run = this.importRuns.get(runId);
    return run ? structuredClone(run) : null;
  }

  async transaction<T>(
    operation: (transaction: ActImportTransaction) => Promise<T>,
  ): Promise<T> {
    this.transactionCount += 1;
    const previous = this.transactionTail;
    let release = () => {};
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const contacts = structuredClone(this.contacts);
      const links = structuredClone(this.externalLinks);
      const linkRunIds = structuredClone(this.externalLinkRunIds);
      const audits = structuredClone(this.auditEntries);
      const runs = structuredClone(this.importRuns);
      const transaction = new InMemoryActImportTransaction(
        contacts,
        links,
        linkRunIds,
        audits,
        runs,
        () => `contact-${this.nextContactNumber++}`,
        () => `organization-${this.nextOrganizationNumber++}`,
        () => this.failAuditWrite,
      );

      const result = await operation(transaction);

      this.contacts.clear();
      contacts.forEach((contact, id) => this.contacts.set(id, contact));
      this.externalLinks.clear();
      links.forEach((ids, externalId) =>
        this.externalLinks.set(externalId, ids),
      );
      this.externalLinkRunIds.clear();
      linkRunIds.forEach((runId, externalId) =>
        this.externalLinkRunIds.set(externalId, runId),
      );
      this.auditEntries.length = 0;
      this.auditEntries.push(...audits);
      this.importRuns.clear();
      runs.forEach((run, id) => this.importRuns.set(id, run));
      return result;
    } finally {
      release();
    }
  }
}

class InMemoryActImportTransaction implements ActImportTransaction {
  constructor(
    private readonly contacts: Map<string, LocalContact>,
    private readonly links: Map<string, string[]>,
    private readonly externalLinkRunIds: Map<string, string>,
    private readonly audits: ImportAuditEntry[],
    private readonly runs: Map<string, ImportRun>,
    private readonly nextContactId: () => string,
    private readonly nextOrganizationId: () => string,
    private readonly shouldFailAudit: () => boolean,
  ) {}

  async createContact(record: ActCsvRecord): Promise<LocalContact> {
    const id = this.nextContactId();
    const contact: LocalContact = {
      id,
      organizationId: record.company ? this.nextOrganizationId() : null,
      organizationName: record.company,
      contactName: record.contact,
      email: record.email,
      phone: record.phone,
    };
    this.contacts.set(id, contact);
    return { ...contact };
  }

  async updateContact(
    contactId: string,
    record: ActCsvRecord,
    expected: LocalContact,
  ): Promise<LocalContact> {
    const current = this.contacts.get(contactId);
    if (!current) throw new Error("Contact disappeared during import.");
    if (JSON.stringify(current) !== JSON.stringify(expected)) {
      const error = new Error("Contact changed after the import preview.");
      error.name = "ActImportContactConflictError";
      throw error;
    }
    const updated = {
      ...current,
      organizationName: record.company,
      contactName: record.contact,
      email: record.email,
      phone: record.phone,
    };
    this.contacts.set(contactId, updated);
    return { ...updated };
  }

  async ensureExternalLink(
    externalId: string,
    contactId: string,
    importRunId?: string,
  ) {
    const contactIds = this.links.get(externalId) ?? [];
    if (contactIds.some((id) => id !== contactId)) {
      return "conflict" as const;
    }
    if (!contactIds.includes(contactId)) {
      this.links.set(externalId, [...contactIds, contactId]);
      if (importRunId) {
        this.externalLinkRunIds.set(externalId, importRunId);
      }
      return "linked" as const;
    }
    return "already_owned" as const;
  }

  async createAuditEntry(entry: ImportAuditEntry) {
    if (this.shouldFailAudit()) throw new Error("Audit write failed.");
    this.audits.push(structuredClone(entry));
  }

  async completeImportRun(runId: string, appliedRowIds: readonly string[]) {
    const run = this.runs.get(runId);
    if (!run) throw new Error("Import run is missing.");
    this.runs.set(runId, {
      ...run,
      status: "completed",
      appliedRowIds: [...appliedRowIds],
    });
  }
}

function contact(
  id: string,
  overrides: Partial<LocalContact> = {},
): LocalContact {
  return {
    id,
    organizationId: `organization-${id}`,
    organizationName: "Marias Fair",
    contactName: "Avery Example",
    email: "avery@example.com",
    phone: "406-555-0101",
    ...overrides,
  };
}

describe("previewActImport", () => {
  it("uses an external link before an email match", async () => {
    const repository = new InMemoryActImportRepository();
    repository.contacts.set(
      "linked",
      contact("linked", { email: "old@example.com" }),
    );
    repository.contacts.set("email", contact("email"));
    repository.externalLinks.set("ACT-001", ["linked"]);

    const preview = await previewActImport([baseRecord], { repository });

    expect(preview.rows[0]).toMatchObject({
      category: "change",
      matchReason: "external_id",
      localContactId: "linked",
    });
  });

  it("matches email case-insensitively", async () => {
    const repository = new InMemoryActImportRepository();
    repository.contacts.set(
      "casey",
      contact("casey", {
        contactName: "Casey Example",
        email: "  CASEY@EXAMPLE.COM ",
      }),
    );

    const preview = await previewActImport(
      [
        {
          ...baseRecord,
          recordId: null,
          contact: "Casey Example",
          email: "casey@example.com",
        },
      ],
      { repository },
    );

    expect(preview.rows[0]).toMatchObject({
      matchReason: "email",
      localContactId: "casey",
    });
  });

  it("uses exact normalized organization and contact after email has no match", async () => {
    const repository = new InMemoryActImportRepository();
    repository.contacts.set(
      "organization-contact",
      contact("organization-contact", {
        organizationName: "  MARIAS FAIR ",
        contactName: " AVERY EXAMPLE ",
        email: null,
      }),
    );

    const preview = await previewActImport(
      [{ ...baseRecord, recordId: null, email: null }],
      { repository },
    );

    expect(preview.rows[0]).toMatchObject({
      matchReason: "organization_contact",
      localContactId: "organization-contact",
    });
  });

  it("marks an unchanged unique match as a duplicate", async () => {
    const repository = new InMemoryActImportRepository();
    repository.contacts.set("same", contact("same"));

    const preview = await previewActImport(
      [{ ...baseRecord, recordId: null }],
      { repository },
    );

    expect(preview.rows[0]).toMatchObject({
      category: "duplicate",
      matchReason: "email",
      localContactId: "same",
      changes: [],
    });
  });

  it("classifies multiple matches at one rule as a conflict", async () => {
    const repository = new InMemoryActImportRepository();
    repository.contacts.set("first", contact("first"));
    repository.contacts.set("second", contact("second"));

    const preview = await previewActImport(
      [{ ...baseRecord, recordId: null }],
      { repository },
    );

    expect(preview.rows[0]).toMatchObject({
      category: "conflict",
      matchReason: "email",
      candidateContactIds: ["first", "second"],
    });
  });

  it("marks every row with a repeated email as conflict when record IDs are absent", async () => {
    const repository = new InMemoryActImportRepository();

    const preview = await previewActImport(
      [
        { ...baseRecord, rowNumber: 4, recordId: null },
        {
          ...baseRecord,
          rowNumber: 9,
          recordId: null,
          contact: "Another Person",
          email: " AVERY@EXAMPLE.COM ",
        },
      ],
      { repository },
    );

    expect(preview.rows.map((row) => row.category)).toEqual([
      "conflict",
      "conflict",
    ]);
    expect(preview.rows[0]?.messages).toContain(
      "CSV rows 4 and 9 share the email avery@example.com.",
    );
    expect(preview.rows[1]?.messages).toContain(
      "CSV rows 4 and 9 share the email avery@example.com.",
    );
  });

  it("marks every repeated Act record ID as conflict", async () => {
    const repository = new InMemoryActImportRepository();

    const preview = await previewActImport(
      [
        { ...baseRecord, rowNumber: 2 },
        {
          ...baseRecord,
          rowNumber: 7,
          contact: "Different Person",
          email: "different@example.com",
        },
      ],
      { repository },
    );

    expect(preview.rows.map((row) => row.category)).toEqual([
      "conflict",
      "conflict",
    ]);
    expect(preview.rows[0]?.messages).toContain(
      "CSV rows 2 and 7 share the Act! record ID ACT-001.",
    );
  });

  it("allows a shared email when distinct Act record IDs identify the rows", async () => {
    const repository = new InMemoryActImportRepository();

    const preview = await previewActImport(
      [
        { ...baseRecord, rowNumber: 2, recordId: "ACT-001" },
        {
          ...baseRecord,
          rowNumber: 3,
          recordId: "ACT-002",
          contact: "Another Person",
        },
      ],
      { repository },
    );

    expect(preview.rows.map((row) => row.category)).toEqual(["new", "new"]);
  });

  it("reports all conflicting CSV row numbers for a repeated organization and contact", async () => {
    const repository = new InMemoryActImportRepository();

    const preview = await previewActImport(
      [
        {
          ...baseRecord,
          rowNumber: 3,
          recordId: null,
          email: null,
        },
        {
          ...baseRecord,
          rowNumber: 8,
          recordId: null,
          email: null,
          company: "  MARIAS   FAIR ",
          contact: " AVERY   EXAMPLE ",
        },
        {
          ...baseRecord,
          rowNumber: 11,
          recordId: null,
          email: null,
        },
      ],
      { repository },
    );

    expect(preview.rows.map((row) => row.category)).toEqual([
      "conflict",
      "conflict",
      "conflict",
    ]);
    for (const row of preview.rows) {
      expect(row.messages).toContain(
        "CSV rows 3, 8, and 11 share the organization and contact Marias Fair / Avery Example.",
      );
    }
  });

  it("isolates malformed rows and performs no contact or booking writes", async () => {
    const repository = new InMemoryActImportRepository();
    repository.bookings.set("booking-1", { id: "booking-1" });
    const beforeContacts = repository.contacts.size;
    const beforeBookings = repository.bookings.size;

    const preview = await previewActImport(
      [
        { ...baseRecord, validationErrors: ["Contact is required."] },
        { ...baseRecord, rowNumber: 3, recordId: "ACT-NEW" },
      ],
      { repository, sourceFileName: "review.csv" },
    );

    expect(preview.rows.map((row) => row.category)).toEqual(["error", "new"]);
    expect(preview.rows[0]?.messages).toContain("Contact is required.");
    expect(repository.contacts.size).toBe(beforeContacts);
    expect(repository.bookings.size).toBe(beforeBookings);
    expect(repository.importRuns).toHaveLength(1);
  });
});

describe("applyActImport", () => {
  it("applies only explicitly approved safe rows in one audited transaction", async () => {
    const repository = new InMemoryActImportRepository();
    repository.contacts.set(
      "existing",
      contact("existing", { phone: "old phone" }),
    );
    const preview = await previewActImport(
      [
        { ...baseRecord, recordId: null },
        {
          ...baseRecord,
          rowNumber: 3,
          recordId: "ACT-NEW",
          contact: "New Person",
          email: "new@example.com",
        },
      ],
      { repository },
    );

    const result = await applyActImport(
      preview.runId,
      [preview.rows[1]!.rowId],
      { repository },
    );

    expect(result).toEqual({
      runId: preview.runId,
      appliedRowIds: [preview.rows[1]!.rowId],
      skippedRowIds: [preview.rows[0]!.rowId],
      failedRows: [],
    });
    expect(repository.transactionCount).toBe(1);
    expect(repository.contacts.get("existing")?.phone).toBe("old phone");
    expect(
      [...repository.contacts.values()].find(
        (value) => value.email === "new@example.com",
      ),
    ).toMatchObject({ contactName: "New Person" });
    expect(repository.externalLinks.get("ACT-NEW")).toHaveLength(1);
    expect(repository.externalLinkRunIds.get("ACT-NEW")).toBe(preview.runId);
    expect(repository.auditEntries).toHaveLength(1);
    expect(repository.importRuns.get(preview.runId)).toMatchObject({
      status: "completed",
      appliedRowIds: [preview.rows[1]!.rowId],
    });
  });

  it("never automatically merges a conflict even if its row id is submitted", async () => {
    const repository = new InMemoryActImportRepository();
    repository.contacts.set("first", contact("first"));
    repository.contacts.set("second", contact("second"));
    const preview = await previewActImport(
      [{ ...baseRecord, recordId: null }],
      { repository },
    );

    const result = await applyActImport(
      preview.runId,
      [preview.rows[0]!.rowId],
      { repository },
    );

    expect(result.appliedRowIds).toEqual([]);
    expect(result.failedRows).toEqual([
      {
        rowId: preview.rows[0]!.rowId,
        message: "Conflict rows cannot be applied automatically.",
      },
    ]);
    expect(repository.transactionCount).toBe(0);
    expect(repository.auditEntries).toHaveLength(0);
  });

  it("rolls back contact and external-link writes if audit storage fails", async () => {
    const repository = new InMemoryActImportRepository();
    const preview = await previewActImport(
      [{ ...baseRecord, recordId: "ACT-NEW", email: "new@example.com" }],
      { repository },
    );
    repository.failAuditWrite = true;

    await expect(
      applyActImport(preview.runId, [preview.rows[0]!.rowId], { repository }),
    ).rejects.toThrow("Audit write failed.");

    expect(repository.contacts).toHaveLength(0);
    expect(repository.externalLinks).toHaveLength(0);
    expect(repository.auditEntries).toHaveLength(0);
    expect(repository.importRuns.get(preview.runId)?.status).toBe("previewed");
  });

  it("does not overwrite a contact changed after preview", async () => {
    const repository = new InMemoryActImportRepository();
    repository.contacts.set(
      "existing",
      contact("existing", { phone: "phone at preview" }),
    );
    const preview = await previewActImport(
      [{ ...baseRecord, recordId: null, phone: "phone from Act" }],
      { repository },
    );
    repository.contacts.set(
      "existing",
      contact("existing", { phone: "newer local phone" }),
    );

    const result = await applyActImport(
      preview.runId,
      [preview.rows[0]!.rowId],
      { repository },
    );

    expect(result.appliedRowIds).toEqual([]);
    expect(result.failedRows).toEqual([
      {
        rowId: preview.rows[0]!.rowId,
        message: "Contact changed after the import preview.",
      },
    ]);
    expect(repository.contacts.get("existing")?.phone).toBe(
      "newer local phone",
    );
    expect(repository.auditEntries).toHaveLength(0);
    expect(repository.importRuns.get(preview.runId)?.status).toBe("previewed");
  });

  it("returns a deterministic conflict when sequential previews compete for one Act ID", async () => {
    const repository = new InMemoryActImportRepository();
    const record = {
      ...baseRecord,
      recordId: "ACT-COMPETING",
      email: "first@example.com",
    };
    const firstPreview = await previewActImport([record], { repository });
    const secondPreview = await previewActImport(
      [{ ...record, email: "second@example.com" }],
      { repository },
    );

    const first = await applyActImport(
      firstPreview.runId,
      [firstPreview.rows[0]!.rowId],
      { repository },
    );
    const second = await applyActImport(
      secondPreview.runId,
      [secondPreview.rows[0]!.rowId],
      { repository },
    );

    expect(first.appliedRowIds).toEqual([firstPreview.rows[0]!.rowId]);
    expect(second).toMatchObject({
      appliedRowIds: [],
      failedRows: [
        {
          rowId: secondPreview.rows[0]!.rowId,
          message: "Act record is already linked to another local contact.",
        },
      ],
    });
    expect(repository.contacts).toHaveLength(1);
    expect(repository.externalLinks.get("ACT-COMPETING")).toHaveLength(1);
    expect(repository.auditEntries).toHaveLength(1);
    expect(repository.importRuns.get(secondPreview.runId)?.status).toBe(
      "previewed",
    );
  });

  it("serializes concurrent competing imports so only one contact owns the external ID", async () => {
    const repository = new InMemoryActImportRepository();
    const firstPreview = await previewActImport(
      [
        {
          ...baseRecord,
          recordId: "ACT-CONCURRENT",
          email: "first@example.com",
        },
      ],
      { repository },
    );
    const secondPreview = await previewActImport(
      [
        {
          ...baseRecord,
          recordId: "ACT-CONCURRENT",
          email: "second@example.com",
        },
      ],
      { repository },
    );

    const results = await Promise.all([
      applyActImport(firstPreview.runId, [firstPreview.rows[0]!.rowId], {
        repository,
      }),
      applyActImport(secondPreview.runId, [secondPreview.rows[0]!.rowId], {
        repository,
      }),
    ]);

    expect(results.filter((result) => result.appliedRowIds.length === 1)).toHaveLength(
      1,
    );
    expect(results.filter((result) => result.failedRows.length === 1)).toHaveLength(
      1,
    );
    expect(repository.contacts).toHaveLength(1);
    expect(repository.externalLinks.get("ACT-CONCURRENT")).toHaveLength(1);
    expect(repository.auditEntries).toHaveLength(1);
  });
});
