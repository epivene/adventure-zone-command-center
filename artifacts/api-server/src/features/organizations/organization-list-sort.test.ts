import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

import { organizationListQuerySchema } from "./last-resort-input";
import { loadProfileSortMetadata } from "./organization-list-sort";

const profileId = "11111111-1111-4111-8111-111111111111";

describe("organization list sorting", () => {
  it("defaults to recently updated", () => {
    expect(organizationListQuerySchema.parse({}).sort).toBe("recently_updated");
  });

  it("accepts every supported directory sort", () => {
    for (const sort of [
      "recently_updated",
      "least_recently_updated",
      "name_asc",
      "name_desc",
      "created_desc",
      "created_asc",
    ] as const) {
      expect(organizationListQuerySchema.parse({ sort }).sort).toBe(sort);
    }
  });

  it("counts profile changes reached through contacts, bookings, follow-ups, and activities", async () => {
    let compiledSql = "";
    await loadProfileSortMetadata([profileId], async (statement) => {
      compiledSql = new PgDialect().sqlToQuery(statement as any).sql;
      return { rows: [] };
    });

    expect(compiledSql).toMatch(/organization_contacts/i);
    expect(compiledSql).toMatch(/contacts/i);
    expect(compiledSql).toMatch(/bookings/i);
    expect(compiledSql).toMatch(/follow_ups/i);
    expect(compiledSql).toMatch(/activities/i);
    expect(compiledSql).toMatch(/updated_at/i);
  });
});
