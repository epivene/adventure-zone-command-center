import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

import { organizationListQuerySchema } from "./last-resort-input";
import { buildOrganizationDirectoryOrderBy } from "./organization-directory-page";

const routeSource = readFileSync(new URL("../../routes/organizations.ts", import.meta.url), "utf8");
const profileTouchSource = readFileSync(new URL("./profile-touch-schema.ts", import.meta.url), "utf8");

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

  it("uses a dedicated last_worked_at timestamp instead of generic updated_at", () => {
    const sql = compiledOrder({ sort: "recently_updated" });
    expect(sql).toMatch(/last_worked_at/i);
    expect(sql).toMatch(/desc/i);
    expect(sql).not.toMatch(/organization_contacts/i);
    expect(sql).not.toMatch(/follow_ups/i);
    expect(sql).not.toMatch(/activities/i);
  });

  it("creates, indexes, and backfills last_worked_at from local direct and associated activity", () => {
    expect(profileTouchSource).toMatch(/ADD COLUMN IF NOT EXISTS last_worked_at/i);
    expect(profileTouchSource).toMatch(/organizations_last_worked_at_idx/i);
    expect(profileTouchSource).toMatch(/activity_associations/i);
    expect(profileTouchSource).toMatch(/source_record_id IS NULL/i);
    expect(profileTouchSource).toMatch(/SET last_worked_at/i);
    expect(profileTouchSource).not.toMatch(/SET updated_at = GREATEST\(updated_at, touched_at\)/i);
  });

  it("touches the owning profile when an organization location is created, edited, or deleted", () => {
    expect(profileTouchSource).toMatch(/touch_profile_from_organization_location/i);
    expect(profileTouchSource).toMatch(/organization_locations_touch_profile_work/i);
    expect(profileTouchSource).toMatch(/AFTER INSERT OR UPDATE OR DELETE ON organization_locations/i);
  });

  it("keeps every supported ordering in the repository query", () => {
    expect(compiledOrder({ sort: "least_recently_updated" })).toMatch(/last_worked_at.*asc/i);
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
