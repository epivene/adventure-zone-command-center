import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

import { organizationListQuerySchema } from "./last-resort-input";
import { buildOrganizationListOrderBy } from "./organization-repository";

function compiledOrder(sort: string) {
  const query = organizationListQuerySchema.parse({ sort });
  return buildOrganizationListOrderBy(query)
    .map((part) => new PgDialect().sqlToQuery(part).sql)
    .join(" ");
}

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

  it("orders the database query by meaningful activity before pagination", () => {
    const recent = compiledOrder("recently_updated");
    const oldestActivity = compiledOrder("least_recently_updated");

    expect(recent).toMatch(/activities/i);
    expect(recent).toMatch(/updated_at/i);
    expect(recent).toMatch(/desc/i);
    expect(oldestActivity).toMatch(/activities/i);
    expect(oldestActivity).toMatch(/updated_at/i);
    expect(oldestActivity).toMatch(/asc/i);
  });

  it("supports alphabetical and creation-date ordering in the database query", () => {
    expect(compiledOrder("name_asc")).toMatch(/name.*asc/i);
    expect(compiledOrder("name_desc")).toMatch(/name.*desc/i);
    expect(compiledOrder("created_desc")).toMatch(/created_at.*desc/i);
    expect(compiledOrder("created_asc")).toMatch(/created_at.*asc/i);
  });
});
