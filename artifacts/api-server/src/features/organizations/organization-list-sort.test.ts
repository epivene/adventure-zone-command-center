import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

import { organizationListQuerySchema } from "./last-resort-input";
import { buildOrganizationListOrderBy } from "./organization-repository";

describe("organization list sorting", () => {
  it("defaults to recently updated", () => {
    const query = organizationListQuerySchema.parse({});
    expect(query.sort).toBe("recently_updated");
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

  it("orders recently updated profiles by profile activity before name", () => {
    const query = organizationListQuerySchema.parse({ sort: "recently_updated" });
    const compiled = buildOrganizationListOrderBy(query)
      .map((part) => new PgDialect().sqlToQuery(part).sql)
      .join(" ");

    expect(compiled).toMatch(/activities/i);
    expect(compiled).toMatch(/updated_at/i);
    expect(compiled).toMatch(/desc/i);
  });

  it("supports alphabetical and creation-date ordering", () => {
    const nameDescending = buildOrganizationListOrderBy(
      organizationListQuerySchema.parse({ sort: "name_desc" }),
    ).map((part) => new PgDialect().sqlToQuery(part).sql).join(" ");
    const oldestFirst = buildOrganizationListOrderBy(
      organizationListQuerySchema.parse({ sort: "created_asc" }),
    ).map((part) => new PgDialect().sqlToQuery(part).sql).join(" ");

    expect(nameDescending).toMatch(/name.*desc/i);
    expect(oldestFirst).toMatch(/created_at.*asc/i);
  });
});
