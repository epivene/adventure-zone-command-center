import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { duplicateOrganizationGroupsQuery } from "./organization-repository";

describe("duplicate organization discovery", () => {
  it("groups exact normalized names even when one duplicate has no location", () => {
    const rendered = new PgDialect().sqlToQuery(
      duplicateOrganizationGroupsQuery(),
    ).sql.toLowerCase();

    expect(rendered).toContain("group by 1");
    expect(rendered).not.toContain("group by 1, 2, 3");
  });
});
