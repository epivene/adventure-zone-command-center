import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  buildContactSearchCondition,
  contactSyncState,
  phoneMatch,
} from "@/features/contacts/contact-repository";
import type { ContactListRecord } from "@/features/contacts/contact-types";

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
