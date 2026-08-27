import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

import { organizationListQuerySchema } from "./last-resort-input";
import { buildOrganizationDirectoryOrderBy } from "./organization-directory-page";

const routeSource = readFileSync(new URL("../../routes/organizations.ts", import.meta.url), "utf8");

function compiledOrder(sort: Parameters<typeof organizationListQuerySchema.parse>[0]) {
  const query = organizationListQuerySchema.parse(sort);
  return buildOrganizationDirectoryOrderBy(query)
    .map((part) => new PgDialect().sqlToQuery(part).sql)
    .join(" ");
}

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

  it("builds relationship-aware recency ordering in the database query", () => {
    const sql = compiledOrder({ sort: "recently_updated" });
    expect(sql).toMatch(/organization_contacts/i);
    expect(sql).toMatch(/contacts/i);
    expect(sql).toMatch(/bookings/i);
    expect(sql).toMatch(/follow_ups/i);
    expect(sql).toMatch(/activities/i);
    expect(sql).toMatch(/updated_at/i);
    expect(sql).toMatch(/desc/i);
  });

  it("keeps every supported ordering in the repository query", () => {
    expect(compiledOrder({ sort: "least_recently_updated" })).toMatch(/asc/i);
    expect(compiledOrder({ sort: "name_asc" })).toMatch(/name.*asc/i);
    expect(compiledOrder({ sort: "name_desc" })).toMatch(/name.*desc/i);
    expect(compiledOrder({ sort: "created_desc" })).toMatch(/created_at.*desc/i);
    expect(compiledOrder({ sort: "created_asc" })).toMatch(/created_at.*asc/i);
  });

  it("does not load 100000 profiles into memory before pagination", () => {
    expect(routeSource).not.toContain("pageSize: 100_000");
    expect(routeSource).not.toContain("sortOrganizationRecords(");
    expect(routeSource).not.toContain("loadProfileSortMetadata(");
  });
});
