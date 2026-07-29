import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { contacts, organizations } from "@/db/schema";
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

type ThenableRows = PromiseLike<
  { contact: ContactRow; organization: OrganizationRow | null }[]
> & {
  limit: (count: number) => ThenableRows;
  for: (
    strength: string,
    options?: unknown,
  ) => Promise<
    { contact: ContactRow; organization: OrganizationRow | null }[]
  >;
};

class RecordingDrizzleDatabase {
  readonly conditions: SQL[] = [];
  readonly contactUpdates: Record<string, unknown>[] = [];
  readonly locks: { source: unknown; strength: string }[] = [];
  organizationInsertCount = 0;

  select() {
    const { conditions, locks } = this;
    return {
      from(source: unknown) {
        const rows = [{ contact: contactRow, organization }];
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
                locks.push({ source, strength });
                return rows;
              },
              then: promise.then.bind(promise),
            } as ThenableRows;
            return terminal;
          },
        };
        return builder;
      },
    };
  }

  insert(table: unknown) {
    if (table === organizations) this.organizationInsertCount += 1;
    return {
      values() {
        return {
          returning: async () => [organization],
        };
      },
    };
  }

  update(table: unknown) {
    const { contactUpdates } = this;
    return {
      set(values: Record<string, unknown>) {
        if (table === contacts) contactUpdates.push(values);
        return {
          where() {
            return {
              returning: async () => [
                {
                  ...contactRow,
                  ...values,
                },
              ],
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

function repository(database: RecordingDrizzleDatabase) {
  return new DrizzleActImportRepository(
    database as unknown as ConstructorParameters<
      typeof DrizzleActImportRepository
    >[0],
  );
}

describe("DrizzleActImportRepository", () => {
  it("locks the matched contact before comparing the preview snapshot", async () => {
    const database = new RecordingDrizzleDatabase();

    await repository(database).transaction((transaction) =>
      transaction.updateContact(contactRow.id, record, expected),
    );

    expect(database.locks).toEqual([
      { source: contacts, strength: "update" },
    ]);
  });

  it("preserves an unchanged organization during a phone-only update", async () => {
    const database = new RecordingDrizzleDatabase();

    const updated = await repository(database).transaction((transaction) =>
      transaction.updateContact(contactRow.id, record, expected),
    );

    expect(database.organizationInsertCount).toBe(0);
    expect(database.contactUpdates).toHaveLength(1);
    expect(database.contactUpdates[0]).toMatchObject({
      organizationId: organization.id,
      phone: "(406) 555-0101",
      normalizedPhone: "+14065550101",
    });
    expect(updated).toMatchObject({
      organizationId: organization.id,
      organizationName: organization.name,
      phone: "(406) 555-0101",
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
