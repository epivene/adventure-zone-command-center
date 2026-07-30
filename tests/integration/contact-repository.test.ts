import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { PgDialect } from "drizzle-orm/pg-core";
import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as crmSchema from "@/db/schema";
import {
  DrizzleSyncRepository,
  LocalContactChangedAfterPreviewError,
} from "@/features/act-sync/sync-repository";
import type { SyncComparisonRow } from "@/features/act-sync/sync-comparison";
import {
  buildContactSearchCondition,
  contactSyncState,
  DrizzleContactRepository,
  phoneMatch,
} from "@/features/contacts/contact-repository";
import type { ContactInput } from "@/features/contacts/contact-input";
import type { ContactListRecord, QuickCallerInput } from "@/features/contacts/contact-types";
import { crmTestDatabaseUrl } from "@/tests/helpers/crm-test-database";

const databaseUrl = crmTestDatabaseUrl();
const migrationDirectory = path.resolve(import.meta.dirname, "../../db/migrations");

function testSchemaName() {
  return `contact_repository_${randomUUID().replaceAll("-", "_")}`;
}

async function migrationStatements(fileName: string, schemaName: string) {
  const contents = await readFile(path.join(migrationDirectory, fileName), "utf8");
  return contents
    .replaceAll('"public".', `"${schemaName}".`)
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

async function waitForDatabaseLock(sql: postgres.Sql, backendPid: number) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [activity] = await sql.unsafe(`
      SELECT wait_event_type FROM pg_stat_activity WHERE pid = ${backendPid}
    `);
    if (activity?.wait_event_type === "Lock") return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Expected the database session to wait on a lock.");
}

function queryTerminal<T>(records: T[]) {
  const promise = Promise.resolve(records);
  const terminal = {
    limit: () => terminal,
    for: () => promise,
    then: promise.then.bind(promise),
  };
  return terminal;
}

class DisappearingContactDatabase {
  readonly createdOrganizationId =
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  readonly organizations = new Map<string, Record<string, unknown>>();
  readonly audits: Array<Record<string, unknown>> = [];
  readonly events: string[] = [];
  candidateExists = true;
  executeError: Error | null = null;

  async execute() {
    if (this.executeError) throw this.executeError;
    this.events.push("lock:organization-name");
    return [];
  }

  select() {
    return {
      from: (table: unknown) => {
        let joined = false;
        const builder = {
          leftJoin: () => {
            joined = true;
            return builder;
          },
          where: () => {
            if (table === crmSchema.organizations) {
              return queryTerminal([]);
            }
            if (table === crmSchema.contacts) {
              const records =
                this.candidateExists && !joined
                  ? [{ id: repositoryIds.existingContact }]
                  : [];
              if (joined) this.events.push("recheck:contact-missing");
              return queryTerminal(records);
            }
            return queryTerminal([]);
          },
        };
        return builder;
      },
    };
  }

  insert(table: unknown) {
    return {
      values: (values: Record<string, unknown>) => {
        if (table === crmSchema.organizations) {
          this.organizations.set(this.createdOrganizationId, {
            ...values,
            id: this.createdOrganizationId,
          });
          this.events.push("insert:organization");
          return {
            returning: async () => [{ id: this.createdOrganizationId }],
          };
        }
        if (table === crmSchema.auditEntries) {
          this.audits.push({ ...values });
          this.events.push("insert:audit");
          return {};
        }
        throw new Error("Unexpected insert in disappearance test.");
      },
    };
  }

  async transaction<T>(
    operation: (transaction: DisappearingContactDatabase) => Promise<T>,
  ) {
    const organizationsBefore = new Map(this.organizations);
    const auditsBefore = this.audits.map((entry) => ({ ...entry }));
    try {
      const result = await operation(this);
      this.events.push("commit");
      return result;
    } catch (error) {
      this.organizations.clear();
      for (const [id, organization] of organizationsBefore) {
        this.organizations.set(id, organization);
      }
      this.audits.splice(0, this.audits.length, ...auditsBefore);
      this.events.push("rollback");
      throw error;
    }
  }
}

const repositoryIds = {
  organization: "11111111-1111-4111-8111-111111111111",
  secondOrganization: "33333333-3333-4333-8333-333333333333",
  existingContact: "22222222-2222-4222-8222-222222222222",
  disappearingContact: "44444444-4444-4444-8444-444444444444",
};

const quickCaller: QuickCallerInput = {
  requestKey: "99999999-9999-4999-8999-999999999999",
  firstName: "Bailey",
  lastName: "Caller",
  organizationName: "  marias   fair ",
  phone: "406-555-0111",
  email: "bailey@example.com",
  reason: "Asked about an August event.",
  eventDate: "2026-08-14",
  eventLocation: "Shelby, MT",
};

const localContact: ContactInput = {
  firstName: "Jordan",
  lastName: "Local",
  organizationName: "Marias Fair",
  jobTitle: null,
  email: null,
  phone: null,
  address1: null,
  address2: null,
  city: null,
  region: null,
  postalCode: null,
};

describe("contact repository query contract", () => {
  it("searches contact name, company, email, phone, and location", () => {
    const condition = buildContactSearchCondition("North Dakota");
    expect(condition).not.toBeNull();

    const query = new PgDialect().sqlToQuery(condition!);
    expect(query.sql).toContain("first_name");
    expect(query.sql).toContain("last_name");
    expect(query.sql).toContain("organizations");
    expect(query.sql).toContain("email");
    expect(query.sql).toContain("phone");
    expect(query.sql).toContain("city");
    expect(query.sql).toContain("region");
    expect(query.sql).toContain("postal_code");
    expect(query.params).toEqual(
      Array.from({ length: 7 }, () => "%North Dakota%"),
    );
  });

  it("treats a missing sync row as unlinked", () => {
    expect(contactSyncState(null)).toBe("unlinked");
    expect(contactSyncState("waiting")).toBe("waiting");
  });

  it("returns one, many, or no exact caller matches without fuzzy phone results", () => {
    const contact = {
      id: "contact-1",
      firstName: "Avery",
      lastName: "Example",
      organizationName: "Marias Fair",
      jobTitle: null,
      email: null,
      phone: "406-555-0101",
      address1: null,
      address2: null,
      city: null,
      region: null,
      postalCode: null,
      syncState: "unlinked",
      updatedAt: new Date("2026-07-28T12:00:00Z"),
      lastSyncedAt: null,
    } satisfies ContactListRecord;

    expect(phoneMatch("+14065550101", [contact])).toEqual({ kind: "one", contact });
    expect(phoneMatch("+14065550101", [contact, { ...contact, id: "contact-2" }])).toEqual({
      kind: "many",
      contacts: [contact, { ...contact, id: "contact-2" }],
    });
    expect(phoneMatch("+14065550101", [])).toEqual({
      kind: "none",
      normalizedPhone: "+14065550101",
    });
  });
});

describe("DrizzleContactRepository update rollback semantics", () => {
  it("returns false and rolls back a newly created Place when the Contact disappears", async () => {
    const database = new DisappearingContactDatabase();
    const repository = new DrizzleContactRepository(database as never);

    await expect(
      repository.updateContact(repositoryIds.existingContact, {
        ...localContact,
        organizationName: "Race Fair",
      }),
    ).resolves.toBe(false);

    expect(database.organizations.size).toBe(0);
    expect(database.audits).toEqual([]);
    expect(database.events).toEqual([
      "lock:organization-name",
      "insert:organization",
      "insert:audit",
      "recheck:contact-missing",
      "rollback",
    ]);
  });

  it("returns false without resolving a Place when the initial probe misses", async () => {
    const database = new DisappearingContactDatabase();
    database.candidateExists = false;

    await expect(
      new DrizzleContactRepository(database as never).updateContact(
        repositoryIds.existingContact,
        {
          ...localContact,
          organizationName: "Race Fair",
        },
      ),
    ).resolves.toBe(false);

    expect(database.organizations.size).toBe(0);
    expect(database.audits).toEqual([]);
    expect(database.events).toEqual(["commit"]);
  });

  it("rethrows unrelated transaction errors", async () => {
    const database = new DisappearingContactDatabase();
    const unrelated = new Error("database unavailable");
    database.executeError = unrelated;

    await expect(
      new DrizzleContactRepository(database as never).updateContact(
        repositoryIds.existingContact,
        {
          ...localContact,
          organizationName: "Race Fair",
        },
      ),
    ).rejects.toBe(unrelated);
  });
});

describe("DrizzleContactRepository caller matching and intake", () => {
  const postgresTest = databaseUrl ? it : it.skip;
  let sql: postgres.Sql | undefined;
  let schemaName = "";
  let repository: DrizzleContactRepository;

  beforeEach(async () => {
    if (!databaseUrl) return;
    schemaName = testSchemaName();
    sql = postgres(databaseUrl, { max: 1 });
    await sql.unsafe(`CREATE SCHEMA "${schemaName}"`);
    await sql.unsafe(`SET search_path TO "${schemaName}", public`);
    const journal = JSON.parse(
      await readFile(path.join(migrationDirectory, "meta", "_journal.json"), "utf8"),
    ) as { entries: { tag: string }[] };
    for (const entry of journal.entries) {
      for (const statement of await migrationStatements(`${entry.tag}.sql`, schemaName)) {
        await sql.unsafe(statement);
      }
    }
    const db = drizzle({ client: sql, schema: crmSchema });
    repository = new DrizzleContactRepository(db);
    await db.insert(crmSchema.organizations).values({
      id: repositoryIds.organization,
      name: "Marias Fair",
      actRecordId: "ACT-ORG-1",
    });
    await db.insert(crmSchema.contacts).values({
      id: repositoryIds.existingContact,
      organizationId: null,
      firstName: "Avery",
      lastName: "Example",
      phone: "(406) 555-0101",
      normalizedPhone: "+14065550101",
      actRecordId: "ACT-CONTACT-1",
    });
    await db.insert(crmSchema.organizationContacts).values({
      organizationId: repositoryIds.organization,
      contactId: repositoryIds.existingContact,
      active: true,
      source: "legacy_backfill",
    });
    await sql.unsafe(`
      UPDATE contacts
      SET organization_id = '${repositoryIds.organization}'
      WHERE id = '${repositoryIds.existingContact}'
    `);
    await db.insert(crmSchema.actContactSyncStates).values({
      contactId: repositoryIds.existingContact,
      state: "synced",
      localDirty: false,
    });
  });

  afterEach(async () => {
    if (!sql) return;
    try {
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    } finally {
      await sql.end({ timeout: 5 });
      sql = undefined;
    }
  });

  postgresTest("creates an active Place-Person association with Quick Add", async () => {
    await expect(repository.findContactsByPhone("406.555.0101")).resolves.toMatchObject({
      kind: "one",
      contact: { id: repositoryIds.existingContact },
    });
    await sql!.unsafe(`
      INSERT INTO contacts (id, organization_id, first_name, last_name, phone, normalized_phone)
      VALUES ('33333333-3333-4333-8333-333333333333', NULL, 'Avery', 'Duplicate', '406-555-0101', '+14065550101');
      INSERT INTO organization_contacts (organization_id, contact_id, source)
      VALUES ('${repositoryIds.organization}', '33333333-3333-4333-8333-333333333333', 'legacy_backfill');
      UPDATE contacts
      SET organization_id = '${repositoryIds.organization}'
      WHERE id = '33333333-3333-4333-8333-333333333333';
    `);
    await expect(repository.findContactsByPhone("1 406 555 0101")).resolves.toMatchObject({
      kind: "many",
      contacts: [
        { id: "33333333-3333-4333-8333-333333333333" },
        { id: repositoryIds.existingContact },
      ],
    });
    await expect(repository.findContactsByPhone("406-555-0199")).resolves.toEqual({
      kind: "none",
      normalizedPhone: "+14065550199",
    });

    const created = await repository.createQuickCaller(quickCaller);
    expect(created).toMatchObject({ kind: "created" });
    if (created.kind !== "created") throw new Error("Expected a new caller.");
    const contactId = created.contactId;

    expect(await sql!.unsafe("SELECT id, act_record_id FROM organizations ORDER BY id")).toEqual([
      { id: repositoryIds.organization, act_record_id: "ACT-ORG-1" },
    ]);
    expect(await sql!.unsafe(`SELECT organization_id, phone, normalized_phone, act_record_id FROM contacts WHERE id = '${contactId}'`)).toEqual([
      {
        organization_id: repositoryIds.organization,
        phone: "406-555-0111",
        normalized_phone: "+14065550111",
        act_record_id: null,
      },
    ]);
    expect(await sql!.unsafe(`
      SELECT organization_id, contact_id, active, source
      FROM organization_contacts
      WHERE contact_id = '${contactId}'
    `)).toEqual([{
      organization_id: repositoryIds.organization,
      contact_id: contactId,
      active: true,
      source: "local",
    }]);
    expect(await sql!.unsafe(`SELECT state, local_dirty FROM act_contact_sync_states WHERE contact_id = '${contactId}'`)).toEqual([
      { state: "waiting", local_dirty: true },
    ]);
    expect(await sql!.unsafe(`SELECT kind, body FROM activities WHERE contact_id = '${contactId}'`)).toEqual([
      {
        kind: "note",
        body: "Reason for calling: Asked about an August event.\nEvent date: 2026-08-14\nEvent location: Shelby, MT",
      },
    ]);
    expect(await sql!.unsafe(`SELECT entity_type, action FROM audit_entries WHERE entity_id = '${contactId}' ORDER BY entity_type`)).toEqual([
      { entity_type: "contact", action: "create" },
    ]);
    expect(await sql!.unsafe("SELECT entity_type, action FROM audit_entries ORDER BY entity_type, action")).toEqual([
      { entity_type: "activity", action: "create" },
      { entity_type: "contact", action: "create" },
    ]);
    expect(await sql!.unsafe(`SELECT act_record_id FROM contacts WHERE id = '${repositoryIds.existingContact}'`)).toEqual([
      { act_record_id: "ACT-CONTACT-1" },
    ]);
  });

  postgresTest("creates an active Place-Person association with a new contact", async () => {
    const contactId = await repository.createContact(localContact);

    expect(await sql!.unsafe(`
      SELECT c.organization_id, oc.active, oc.source
      FROM contacts c
      JOIN organization_contacts oc
        ON oc.organization_id = c.organization_id AND oc.contact_id = c.id
      WHERE c.id = '${contactId}'
    `)).toEqual([{
      organization_id: repositoryIds.organization,
      active: true,
      source: "local",
    }]);
  });

  postgresTest("keeps the previous association and adds the new one when the primary Place changes", async () => {
    await sql!`
      insert into organizations (id, name)
      values (${repositoryIds.secondOrganization}, 'Toole County Fair')
    `;
    const contactId = await repository.createContact(localContact);

    await expect(repository.updateContact(contactId, {
      ...localContact,
      organizationName: "Toole County Fair",
    })).resolves.toBe(true);

    expect(await sql!`
      select organization_id, contact_id, active
      from organization_contacts
      where contact_id = ${contactId}
      order by organization_id
    `).toEqual([
      {
        organization_id: repositoryIds.organization,
        contact_id: contactId,
        active: true,
      },
      {
        organization_id: repositoryIds.secondOrganization,
        contact_id: contactId,
        active: true,
      },
    ]);
    expect(await sql!`
      select organization_id
      from contacts
      where id = ${contactId}
    `).toEqual([{ organization_id: repositoryIds.secondOrganization }]);
  });

  postgresTest("rolls back a newly resolved Place when the Contact disappears before the locked recheck", async () => {
    const lockClient = postgres(databaseUrl!, { max: 1 });
    const updateClient = postgres(databaseUrl!, { max: 1 });
    const observerClient = postgres(databaseUrl!, { max: 1 });
    const placeLockHeld = deferred();
    const releasePlaceLock = deferred();
    let placeLock: Promise<unknown> | undefined;
    let update: Promise<boolean> | undefined;
    try {
      await Promise.all([
        lockClient.unsafe(`SET search_path TO "${schemaName}", public`),
        updateClient.unsafe(`SET search_path TO "${schemaName}", public`),
        observerClient.unsafe(`SET search_path TO "${schemaName}", public`),
      ]);
      await updateClient.unsafe("SET lock_timeout = '5s'");
      const [{ pid: updatePid } = { pid: 0 }] =
        await updateClient.unsafe<{ pid: number }[]>(
          "SELECT pg_backend_pid() AS pid",
        );
      if (!updatePid) throw new Error("Could not identify the update session.");
      await sql!.unsafe(`
        INSERT INTO contacts (id, first_name, last_name)
        VALUES ('${repositoryIds.disappearingContact}', 'Race', 'Condition')
      `);

      placeLock = lockClient.begin(async (transaction) => {
        await transaction.unsafe(`
          SELECT pg_advisory_xact_lock(
            hashtextextended('organization:race fair', 0)
          )
        `);
        placeLockHeld.resolve();
        await releasePlaceLock.promise;
      });
      await placeLockHeld.promise;

      const updateRepository = new DrizzleContactRepository(
        drizzle({ client: updateClient, schema: crmSchema }),
      );
      update = updateRepository.updateContact(
        repositoryIds.disappearingContact,
        {
          ...localContact,
          organizationName: "Race Fair",
        },
      );
      await waitForDatabaseLock(observerClient, updatePid);
      await sql!.unsafe(`
        DELETE FROM contacts
        WHERE id = '${repositoryIds.disappearingContact}'
      `);

      releasePlaceLock.resolve();
      await placeLock;
      await expect(update).resolves.toBe(false);
      expect(
        await sql!.unsafe(`
          SELECT id FROM organizations
          WHERE lower(name) = 'race fair'
        `),
      ).toEqual([]);
      expect(
        await sql!.unsafe(`
          SELECT id FROM audit_entries
          WHERE entity_type = 'organization'
            AND action = 'create'
            AND after->>'name' = 'Race Fair'
        `),
      ).toEqual([]);
    } finally {
      releasePlaceLock.resolve();
      if (placeLock) await placeLock;
      if (update) await Promise.allSettled([update]);
      await lockClient.end({ timeout: 5 });
      await updateClient.end({ timeout: 5 });
      await observerClient.end({ timeout: 5 });
    }
  });

  postgresTest("avoids a Contact update versus Act snapshot deadlock with Place then Person locks", async () => {
    const personLockClient = postgres(databaseUrl!, { max: 1 });
    const actClient = postgres(databaseUrl!, { max: 1 });
    const updateClient = postgres(databaseUrl!, { max: 1 });
    const observerClient = postgres(databaseUrl!, { max: 1 });
    const personLockHeld = deferred();
    const releasePersonLock = deferred();
    const writes: Promise<unknown>[] = [];
    let personLock: Promise<unknown> | undefined;
    try {
      await Promise.all([
        personLockClient.unsafe(`SET search_path TO "${schemaName}", public`),
        actClient.unsafe(`SET search_path TO "${schemaName}", public`),
        updateClient.unsafe(`SET search_path TO "${schemaName}", public`),
        observerClient.unsafe(`SET search_path TO "${schemaName}", public`),
      ]);
      await actClient.unsafe("SET lock_timeout = '5s'");
      await updateClient.unsafe("SET lock_timeout = '5s'");
      const [{ pid: actPid } = { pid: 0 }] =
        await actClient.unsafe<{ pid: number }[]>(
          "SELECT pg_backend_pid() AS pid",
        );
      const [{ pid: updatePid } = { pid: 0 }] =
        await updateClient.unsafe<{ pid: number }[]>(
          "SELECT pg_backend_pid() AS pid",
        );
      if (!actPid || !updatePid) {
        throw new Error("Could not identify the concurrent database sessions.");
      }

      personLock = personLockClient.begin(async (transaction) => {
        await transaction.unsafe(`
          SELECT id FROM contacts
          WHERE id = '${repositoryIds.existingContact}'
          FOR UPDATE
        `);
        personLockHeld.resolve();
        await releasePersonLock.promise;
      });
      await personLockHeld.promise;

      const previewSnapshot = {
        firstName: "Avery",
        lastName: "Example",
        organizationName: "Marias Fair",
        jobTitle: null,
        email: null,
        phone: "(406) 555-0101",
        address1: null,
        address2: null,
        city: null,
        region: null,
        postalCode: null,
      };
      const previewRow = {
        rowId: `local:${repositoryIds.existingContact}`,
        category: "changed_in_app",
        matchReason: "act_record_id",
        localContactId: repositoryIds.existingContact,
        actRecordId: "ACT-CONTACT-1",
        candidateLocalContactIds: [repositoryIds.existingContact],
        candidateActRecordIds: ["ACT-CONTACT-1"],
        baseSnapshot: previewSnapshot,
        localSnapshot: previewSnapshot,
        actSnapshot: previewSnapshot,
        actEditedAt: null,
        allowedDecisions: ["push", "skip"],
        messages: [],
      } satisfies SyncComparisonRow;
      const actRepository = new DrizzleSyncRepository(
        drizzle({ client: actClient, schema: crmSchema }),
      );
      const actSnapshot = actRepository.assertLocalContactUnchanged(previewRow);
      writes.push(actSnapshot);
      await waitForDatabaseLock(observerClient, actPid);

      const updateRepository = new DrizzleContactRepository(
        drizzle({ client: updateClient, schema: crmSchema }),
      );
      const contactUpdate = updateRepository.updateContact(
        repositoryIds.existingContact,
        {
          ...localContact,
          organizationName: "Marias Fair",
        },
      );
      writes.push(contactUpdate);
      await waitForDatabaseLock(observerClient, updatePid);

      releasePersonLock.resolve();
      await personLock;
      await expect(Promise.all([actSnapshot, contactUpdate])).resolves.toEqual([
        true,
        true,
      ]);
    } finally {
      releasePersonLock.resolve();
      if (personLock) await personLock;
      await Promise.allSettled(writes);
      await personLockClient.end({ timeout: 5 });
      await actClient.end({ timeout: 5 });
      await updateClient.end({ timeout: 5 });
      await observerClient.end({ timeout: 5 });
    }
  });

  postgresTest("rejects an Act pull after a concurrent current Place rename", async () => {
    const renameClient = postgres(databaseUrl!, { max: 1 });
    const pullClient = postgres(databaseUrl!, { max: 1 });
    const observerClient = postgres(databaseUrl!, { max: 1 });
    const renameHeld = deferred();
    const releaseRename = deferred();
    let rename: Promise<unknown> | undefined;
    let pull: Promise<string> | undefined;
    try {
      await Promise.all([
        renameClient.unsafe(`SET search_path TO "${schemaName}", public`),
        pullClient.unsafe(`SET search_path TO "${schemaName}", public`),
        observerClient.unsafe(`SET search_path TO "${schemaName}", public`),
      ]);
      await pullClient.unsafe("SET lock_timeout = '5s'");
      const [{ pid: pullPid } = { pid: 0 }] =
        await pullClient.unsafe<{ pid: number }[]>(
          "SELECT pg_backend_pid() AS pid",
        );
      if (!pullPid) throw new Error("Could not identify the Act pull session.");

      rename = renameClient.begin(async (transaction) => {
        await transaction.unsafe(`
          UPDATE organizations
          SET name = 'Renamed after preview'
          WHERE id = '${repositoryIds.organization}'
        `);
        renameHeld.resolve();
        await releaseRename.promise;
      });
      await renameHeld.promise;

      const previewSnapshot = {
        firstName: "Avery",
        lastName: "Example",
        organizationName: "Marias Fair",
        jobTitle: null,
        email: null,
        phone: "(406) 555-0101",
        address1: null,
        address2: null,
        city: null,
        region: null,
        postalCode: null,
      };
      const previewRow = {
        rowId: `act:ACT-CONTACT-1`,
        category: "changed_in_act",
        matchReason: "act_record_id",
        localContactId: repositoryIds.existingContact,
        actRecordId: "ACT-CONTACT-1",
        candidateLocalContactIds: [repositoryIds.existingContact],
        candidateActRecordIds: ["ACT-CONTACT-1"],
        baseSnapshot: previewSnapshot,
        localSnapshot: previewSnapshot,
        actSnapshot: {
          ...previewSnapshot,
          organizationName: null,
        },
        actEditedAt: "2026-08-01T15:10:00.000Z",
        allowedDecisions: ["pull", "skip"],
        messages: [],
      } satisfies SyncComparisonRow;
      const actRepository = new DrizzleSyncRepository(
        drizzle({ client: pullClient, schema: crmSchema }),
      );
      pull = actRepository.pullContact(previewRow, {
        id: "ACT-CONTACT-1",
        ...previewSnapshot,
        organizationName: null,
        editedAt: "2026-08-01T15:10:00.000Z",
      });
      await waitForDatabaseLock(observerClient, pullPid);

      releaseRename.resolve();
      await rename;
      await expect(pull).rejects.toBeInstanceOf(
        LocalContactChangedAfterPreviewError,
      );
      expect(
        await sql!.unsafe(`
          SELECT organization_id
          FROM contacts
          WHERE id = '${repositoryIds.existingContact}'
        `),
      ).toEqual([{ organization_id: repositoryIds.organization }]);
      expect(
        await sql!.unsafe(`
          SELECT id FROM audit_entries
          WHERE entity_type = 'contact'
            AND entity_id = '${repositoryIds.existingContact}'
            AND action = 'act_sync_pulled_update'
        `),
      ).toEqual([]);
    } finally {
      releaseRename.resolve();
      if (rename) await rename;
      if (pull) await Promise.allSettled([pull]);
      await renameClient.end({ timeout: 5 });
      await pullClient.end({ timeout: 5 });
      await observerClient.end({ timeout: 5 });
    }
  });

  postgresTest("replays one concurrent intake request without duplicate local writes", async () => {
    const secondSql = postgres(databaseUrl!, { max: 1 });
    try {
      await secondSql.unsafe(`SET search_path TO "${schemaName}", public`);
      const secondRepository = new DrizzleContactRepository(
        drizzle({ client: secondSql, schema: crmSchema }),
      );

      const [first, replay] = await Promise.all([
        repository.createQuickCaller(quickCaller),
        secondRepository.createQuickCaller(quickCaller),
      ]);

      expect(first).toMatchObject({ kind: "created" });
      expect(replay).toMatchObject({ kind: "created" });
      if (first.kind !== "created" || replay.kind !== "created") {
        throw new Error("Expected a replayed caller creation.");
      }
      expect(replay.contactId).toBe(first.contactId);
      expect(await sql!.unsafe("SELECT count(*) AS value FROM contacts")).toEqual([
        { value: "2" },
      ]);
      expect(await sql!.unsafe("SELECT count(*) AS value FROM activities")).toEqual([
        { value: "1" },
      ]);
      expect(await sql!.unsafe("SELECT count(*) AS value FROM audit_entries")).toEqual([
        { value: "2" },
      ]);
    } finally {
      await secondSql.end({ timeout: 5 });
    }
  });

  postgresTest("serializes normalized organization resolution and audits one creation", async () => {
    const secondSql = postgres(databaseUrl!, { max: 1 });
    try {
      await secondSql.unsafe(`SET search_path TO "${schemaName}", public`);
      const secondRepository = new DrizzleContactRepository(
        drizzle({ client: secondSql, schema: crmSchema }),
      );
      const firstInput = {
        ...quickCaller,
        requestKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        organizationName: "  County   Fair ",
        phone: "406-555-0121",
      };
      const secondInput = {
        ...quickCaller,
        requestKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        organizationName: "county fair",
        phone: "406-555-0122",
      };

      const [first, second] = await Promise.all([
        repository.createQuickCaller(firstInput),
        secondRepository.createQuickCaller(secondInput),
      ]);
      expect(first).toMatchObject({ kind: "created" });
      expect(second).toMatchObject({ kind: "created" });

      expect(await sql!.unsafe(`
        SELECT count(*) AS value
        FROM organizations
        WHERE lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) = 'county fair'
      `)).toEqual([{ value: "1" }]);
      expect(await sql!.unsafe(`
        SELECT count(DISTINCT organization_id) AS organizations, count(*) AS contacts
        FROM contacts
        WHERE phone IN ('406-555-0121', '406-555-0122')
      `)).toEqual([{ organizations: "1", contacts: "2" }]);
      expect(await sql!.unsafe(`
        SELECT count(*) AS value
        FROM audit_entries
        WHERE entity_type = 'organization' AND action = 'create'
      `)).toEqual([{ value: "1" }]);
    } finally {
      await secondSql.end({ timeout: 5 });
    }
  });

  postgresTest("rolls caller, activity, and audits back together when an activity or audit write is rejected", async () => {
    await sql!.unsafe(`
      CREATE FUNCTION "${schemaName}".reject_caller_note() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'note rejected'; END; $$;
      CREATE TRIGGER reject_caller_note BEFORE INSERT ON activities
      FOR EACH ROW EXECUTE FUNCTION "${schemaName}".reject_caller_note();
    `);
    await expect(repository.createQuickCaller(quickCaller)).rejects.toThrow("note rejected");
    expect(await sql!.unsafe("SELECT count(*) AS value FROM contacts")).toEqual([{ value: "1" }]);
    expect(await sql!.unsafe("SELECT count(*) AS value FROM audit_entries")).toEqual([{ value: "0" }]);
    await sql!.unsafe("DROP TRIGGER reject_caller_note ON activities");

    await sql!.unsafe(`
      CREATE FUNCTION "${schemaName}".reject_caller_audit() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.entity_type = 'activity' THEN RAISE EXCEPTION 'activity audit rejected'; END IF;
        RETURN NEW;
      END; $$;
      CREATE TRIGGER reject_caller_audit BEFORE INSERT ON audit_entries
      FOR EACH ROW EXECUTE FUNCTION "${schemaName}".reject_caller_audit();
    `);
    await expect(repository.createQuickCaller(quickCaller)).rejects.toThrow("activity audit rejected");
    expect(await sql!.unsafe("SELECT count(*) AS value FROM contacts")).toEqual([{ value: "1" }]);
    expect(await sql!.unsafe("SELECT count(*) AS value FROM activities")).toEqual([{ value: "0" }]);
    expect(await sql!.unsafe("SELECT count(*) AS value FROM audit_entries")).toEqual([{ value: "0" }]);
  });
});
