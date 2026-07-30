import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  actExternalLinks,
  contacts,
  organizationContacts,
  organizations,
} from "@/db/schema";
import { DrizzleActImportRepository } from "@/features/import/act-matcher";
import type {
  ActCsvRecord,
  LocalContact,
} from "@/features/import/act-types";

type ContactRow = typeof contacts.$inferSelect;
type OrganizationRow = typeof organizations.$inferSelect;

const organization: OrganizationRow = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Marias Fair",
  actRecordId: null,
  placeType: "other",
  actIndustry: null,
  phone: null,
  normalizedPhone: null,
  address1: null,
  address2: null,
  city: null,
  region: null,
  postalCode: null,
  website: null,
  lastResort: false,
  lastResortReason: null,
  lastResortChangedAt: null,
  createdAt: new Date("2026-07-25T12:00:00.000Z"),
  updatedAt: new Date("2026-07-25T12:00:00.000Z"),
};

const contactRow: ContactRow = {
  id: "22222222-2222-4222-8222-222222222222",
  organizationId: organization.id,
  firstName: "Avery",
  lastName: "Example",
  email: "avery@example.com",
  phone: "old phone",
  normalizedPhone: null,
  quickAddRequestKey: null,
  jobTitle: null,
  address1: null,
  address2: null,
  city: null,
  region: null,
  postalCode: null,
  actRecordId: null,
  createdAt: new Date("2026-07-25T12:00:00.000Z"),
  updatedAt: new Date("2026-07-25T12:00:00.000Z"),
};

const record: ActCsvRecord = {
  rowNumber: 2,
  recordId: null,
  company: "  MARIAS   FAIR ",
  contact: "Avery Example",
  email: "avery@example.com",
  phone: "(406) 555-0101",
  city: null,
  region: null,
  validationErrors: [],
};

const expected: LocalContact = {
  id: contactRow.id,
  organizationId: organization.id,
  organizationName: organization.name,
  contactName: "Avery Example",
  email: contactRow.email,
  phone: contactRow.phone,
};

class RecordingDrizzleDatabase {
  readonly conditions: SQL[] = [];
  readonly events: string[] = [];
  readonly associations = new Map<string, Record<string, unknown>>();
  contact: ContactRow = structuredClone(contactRow);
  relationshipConflictSet: Record<string, unknown> | null = null;

  select(selection?: Record<string, unknown>) {
    const { conditions, events } = this;
    return {
      from(source: unknown) {
        const rows =
          source === organizations
            ? [organization]
            : source === contacts && selection && "id" in selection
              ? [{ id: contactRow.id }]
              : [{ contact: structuredClone(contactRow), organization }];
        const builder = {
          innerJoin() {
            return builder;
          },
          leftJoin() {
            return builder;
          },
          where(condition: SQL) {
            conditions.push(condition);
            const promise = Promise.resolve(rows);
            const terminal = {
              limit: () => terminal,
              for: async (strength: string) => {
                if (strength === "update") {
                  events.push(
                    `lock:${source === organizations ? "organization" : "contact"}`,
                  );
                }
                return rows;
              },
              then: promise.then.bind(promise),
            };
            return terminal;
          },
        };
        return builder;
      },
    };
  }

  insert(table: unknown) {
    const { associations, events } = this;
    return {
      values: (values: Record<string, unknown>) => {
        if (table === organizationContacts) {
          const key = `${values.organizationId}:${values.contactId}`;
          return {
            onConflictDoUpdate: async (configuration: { set: Record<string, unknown> }) => {
              this.relationshipConflictSet = configuration.set;
              const existing = associations.get(key);
              associations.set(
                key,
                existing ? { ...existing, ...configuration.set } : { ...values },
              );
              events.push("upsert:relationship");
            },
          };
        }
        if (table === contacts) {
          this.contact = { ...this.contact, ...values };
          events.push("insert:contact");
          return { returning: async () => [this.contact] };
        }
        if (table === organizations) events.push("insert:organization");
        return {
          returning: async () => [organization],
        };
      },
    };
  }

  update(table: unknown) {
    return {
      set: (values: Record<string, unknown>) => {
        if (table === contacts) {
          if (typeof values.organizationId === "string") {
            const key = `${values.organizationId}:${this.contact.id}`;
            if (!this.associations.has(key)) {
              throw new Error("primary pointer requires an association");
            }
            this.events.push("update:contact:pointer");
          } else {
            this.events.push("update:contact:fields");
          }
          this.contact = { ...this.contact, ...values };
        }
        return {
          where: () => {
            return {
              returning: async () => [this.contact],
            };
          },
        };
      },
    };
  }

  transaction<T>(
    operation: (transaction: RecordingDrizzleDatabase) => Promise<T>,
  ) {
    return operation(this);
  }
}

class ExternalLinkRecordingDatabase {
  readonly links: Record<string, unknown>[] = [];

  insert(table: unknown) {
    if (table !== actExternalLinks) throw new Error("Unexpected table.");
    return {
      values: (values: Record<string, unknown>) => ({
        onConflictDoNothing: (...arguments_: unknown[]) => {
          if (arguments_.length > 0) {
            throw new Error("Expected targetless canonical-link conflict handling.");
          }
          return {
            returning: async () => {
              const sourceOwner = this.links.find(
                (link) =>
                  link.sourceEntityType === values.sourceEntityType &&
                  link.actRecordId === values.actRecordId,
              );
              const existingPrimary = this.links.find(
                (link) =>
                  link.entityType === values.entityType &&
                  link.entityId === values.entityId &&
                  link.sourceEntityType === values.sourceEntityType &&
                  link.isPrimary === true,
              );
              if (sourceOwner || existingPrimary) return [];
              this.links.push({ ...values });
              return [{ entityId: values.entityId }];
            },
          };
        },
      }),
    };
  }

  select() {
    return {
      from: (table: unknown) => {
        if (table !== actExternalLinks) throw new Error("Unexpected table.");
        return {
          where: (condition: SQL) => {
            const query = new PgDialect().sqlToQuery(condition);
            const externalId = query.params.at(-1);
            const rows = this.links.filter(
              (link) => link.actRecordId === externalId,
            );
            return { limit: async () => rows };
          },
        };
      },
    };
  }

  transaction<T>(
    operation: (transaction: ExternalLinkRecordingDatabase) => Promise<T>,
  ) {
    return operation(this);
  }
}

function repository(database: RecordingDrizzleDatabase) {
  return new DrizzleActImportRepository(
    database as unknown as ConstructorParameters<
      typeof DrizzleActImportRepository
    >[0],
  );
}

describe("DrizzleActImportRepository", () => {
  it("creates one primary two-way Contact link and preserves it when a different Act id is imported", async () => {
    const database = new ExternalLinkRecordingDatabase();
    const importRepository = new DrizzleActImportRepository(database as never);

    const claims = await importRepository.transaction(async (transaction) => [
      await transaction.ensureExternalLink(
        "ACT-CONTACT-PRIMARY",
        contactRow.id,
        "77777777-7777-4777-8777-777777777777",
      ),
      await transaction.ensureExternalLink(
        "ACT-CONTACT-DIFFERENT",
        contactRow.id,
        "77777777-7777-4777-8777-777777777777",
      ),
    ]);

    expect(claims).toEqual(["linked", "conflict"]);
    expect(database.links).toEqual([
      expect.objectContaining({
        entityType: "contact",
        sourceEntityType: "contact",
        entityId: contactRow.id,
        actRecordId: "ACT-CONTACT-PRIMARY",
        isPrimary: true,
        syncMode: "two_way",
      }),
    ]);
  });

  it("locks the target Place before the Contact during legacy import update", async () => {
    const database = new RecordingDrizzleDatabase();

    await repository(database).transaction((transaction) =>
      transaction.updateContact(contactRow.id, record, expected),
    );

    expect(database.events.filter((event) => event.startsWith("lock:"))).toEqual([
      "lock:organization",
      "lock:contact",
      "lock:contact",
    ]);
  });

  it("creates an association before the compatibility pointer during legacy Act! import create", async () => {
    const database = new RecordingDrizzleDatabase();

    const created = await repository(database).transaction((writer) =>
      writer.createContact(record),
    );

    expect(created.organizationId).toBe(organization.id);
    expect(database.contact.organizationId).toBe(organization.id);
    expect(database.events).toContain("upsert:relationship");
    expect(database.events.indexOf("upsert:relationship")).toBeLessThan(
      database.events.indexOf("update:contact:pointer"),
    );
  });

  it("reactivates the target association without overwriting reviewed fields during legacy Act! import update", async () => {
    const database = new RecordingDrizzleDatabase();
    database.associations.set(`${organization.id}:${contactRow.id}`, {
      organizationId: organization.id,
      contactId: contactRow.id,
      role: "Reviewed role",
      isPrimary: true,
      active: false,
      source: "local",
    });

    const updated = await repository(database).transaction((writer) =>
      writer.updateContact(contactRow.id, record, expected),
    );

    expect(updated.organizationId).toBe(organization.id);
    expect(database.contact.organizationId).toBe(organization.id);
    expect(database.relationshipConflictSet).toEqual({
      active: true,
      source: "act_import",
      updatedAt: expect.any(Date),
    });
    expect(database.associations.get(`${organization.id}:${contactRow.id}`)).toMatchObject({
      role: "Reviewed role",
      isPrimary: true,
      active: true,
      source: "act_import",
    });
  });

  it("emits organization and contact matching with collapsed whitespace", async () => {
    const database = new RecordingDrizzleDatabase();

    await repository(database).findByOrganizationAndContact(
      "marias fair",
      "avery example",
    );

    const condition = database.conditions.at(-1);
    expect(condition).toBeDefined();
    const query = new PgDialect().sqlToQuery(condition!);
    expect(query.sql.match(/regexp_replace/g)).toHaveLength(2);
    expect(query.sql.match(/'\\s\+'/g)).toHaveLength(2);
    expect(query.params).toEqual(["marias fair", "avery example"]);
  });
});
