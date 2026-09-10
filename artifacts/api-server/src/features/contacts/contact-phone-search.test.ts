import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { buildContactSearchCondition } from "./contact-repository";

describe("contact phone search", () => {
  it("normalizes formatting and checks primary and alternate phone numbers", () => {
    const condition = buildContactSearchCondition("(307) 555-0199");
    expect(condition).not.toBeNull();
    const query = new PgDialect().sqlToQuery(condition!);

    expect(query.sql).toContain("regexp_replace");
    expect(query.sql).toContain("contact_phones");
    expect(query.params).toContain("%3075550199%");
  });
});
