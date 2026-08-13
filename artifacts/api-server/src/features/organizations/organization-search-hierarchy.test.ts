import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { db as ApplicationDatabase } from "@/db/client";
import {
  buildOrganizationListCondition,
  DrizzleOrganizationRepository,
  type OrganizationListQuery,
} from "./organization-repository";

const parentId = "10000000-0000-4000-8000-000000000001";

function listQuery(search: string): OrganizationListQuery {
  return {
    search,
    lastResort: "all",
    travelLegId: null,
    page: 1,
    pageSize: 50,
  };
}

function render(statement: SQL) {
  return new PgDialect()
    .sqlToQuery(statement)
    .sql.toLowerCase()
    .replace(/\s+/g, " ");
}

function renderCondition(search: string) {
  const condition = buildOrganizationListCondition(listQuery(search));
  expect(condition).toBeDefined();
  return render(condition!);
}

const parentRecord = {
  id: parentId,
  name: "Adventure Zone",
  actRecordId: null,
  placeType: "other",
  phone: null,
  normalizedPhone: null,
  address1: null,
  address2: null,
  city: null,
  region: null,
  postalCode: null,
  website: "https://example.com",
  parentOrganizationId: null,
  lastResort: false,
  lastResortReason: null,
  lastResortChangedAt: null,
  createdAt: new Date("2026-08-13T00:00:00.000Z"),
  updatedAt: new Date("2026-08-13T00:00:00.000Z"),
};

class ListQueryBuilder {
  private table: unknown;

  constructor(
    private readonly database: TestDatabase,
    private readonly selection: Record<string, unknown> | undefined,
  ) {}

  from(table: unknown) {
    this.table = table;
    return this;
  }

  innerJoin() {
    return this;
  }

  where() {
    return this;
  }

  groupBy() {
    return this;
  }

  orderBy(...expressions: unknown[]) {
    this.database.orderExpressions.push(expressions);
    return this;
  }

  limit() {
    return this;
  }

  offset() {
    return this;
  }

  private rows() {
    const keys = Object.keys(this.selection ?? {});

    if (keys.length === 1 && keys[0] === "value") {
      return [{ value: 1 }];
    }
    if (!this.selection) {
      return [parentRecord];
    }
    if (keys.includes("parentOrganizationId") && keys.includes("value")) {
      return [{ parentOrganizationId: parentId, value: 2 }];
    }

    return [];
  }

  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return Promise.resolve(this.rows()).then(onfulfilled, onrejected);
  }
}

class TestDatabase {
  orderExpressions: unknown[][] = [];

  select(selection?: Record<string, unknown>) {
    return new ListQueryBuilder(this, selection);
  }

  asApplicationDatabase() {
    return this as unknown as typeof ApplicationDatabase;
  }
}

describe("hierarchy-aware organization search", () => {
  it("lists a family parent once when no search is supplied", () => {
    const rendered = renderCondition("");

    expect(rendered).toContain(
      '"organizations"."parent_organization_id" is null',
    );
  });

  it("finds a parent by organization name and includes its location count", async () => {
    const rendered = renderCondition("Adventure Zone");
    const database = new TestDatabase();
    const page = await new DrizzleOrganizationRepository(
      database.asApplicationDatabase(),
    ).listOrganizations(listQuery("Adventure Zone"));

    expect(rendered).toContain('"organizations"."name" ilike');
    expect(rendered).toContain("parent_organization.name ilike");
    expect(page.records).toEqual([
      expect.objectContaining({
        id: parentId,
        parent: null,
        locationCount: 2,
      }),
    ]);
  });

  it("finds a child by city", () => {
    const rendered = renderCondition("Austin");

    expect(rendered).toContain('"organizations"."city" ilike');
    expect(rendered).toContain(
      'child_location.parent_organization_id = "organizations"."id"',
    );
  });

  it("finds a child by local contact name", () => {
    const rendered = renderCondition("Morgan Lee");

    expect(rendered).toContain("association.active");
    expect(rendered).toContain("person.first_name");
    expect(rendered).toContain("person.last_name");
    expect(rendered).toContain("concat_ws");
  });

  it("finds a child by phone", () => {
    const rendered = renderCondition("512-555-0100");

    expect(rendered).toContain('"organizations"."phone" ilike');
    expect(rendered).toContain("person.phone ilike");
  });

  it("finds a child by email", () => {
    const rendered = renderCondition("austin@example.com");

    expect(rendered).toContain("person.email ilike");
  });

  it("ranks a direct parent-name match before child matches", async () => {
    const database = new TestDatabase();

    await new DrizzleOrganizationRepository(
      database.asApplicationDatabase(),
    ).listOrganizations(listQuery("Adventure Zone"));

    const firstOrder = render(database.orderExpressions[0]![0] as SQL);
    expect(firstOrder).toContain(
      'case when lower("organizations"."name") = lower($1) then 0',
    );
    expect(firstOrder).toContain(
      'when "organizations"."parent_organization_id" is null then 1 else 2 end',
    );
  });
});
