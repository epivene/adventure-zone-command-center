import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

import { buildOrganizationListCondition } from "./organization-repository";

const baseQuery = {
  search: "Repeat Fair B",
  lastResort: "all" as const,
  travelLegId: null,
  placeType: null,
  region: null,
  hasPhone: false,
  hasEmail: false,
  hasFollowUp: false,
  hasBooking: false,
  hasLocations: false,
  showMembers: false,
  includeRetired: false,
  page: 1,
  pageSize: 25,
};

describe("organization list retired profile filtering", () => {
  it("keeps consolidated profiles hidden even when a search term is present", () => {
    const condition = buildOrganizationListCondition(baseQuery);
    expect(condition).toBeDefined();
    const compiled = new PgDialect().sqlToQuery(condition!);
    expect(compiled.sql).toMatch(/consolidated_into_id[^?]*is null/i);
  });

  it("allows consolidated profiles only when explicitly requested", () => {
    const condition = buildOrganizationListCondition({ ...baseQuery, includeRetired: true });
    expect(condition).toBeDefined();
    const compiled = new PgDialect().sqlToQuery(condition!);
    expect(compiled.sql).not.toMatch(/consolidated_into_id[^?]*is null/i);
  });
});
