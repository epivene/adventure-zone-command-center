import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  buildContactSearchCondition,
  contactSyncState,
} from "@/features/contacts/contact-repository";

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
});
