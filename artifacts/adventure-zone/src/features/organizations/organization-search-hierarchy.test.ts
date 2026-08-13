import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import type { db as ApplicationDatabase } from "@/db/client";
import {
  buildOrganizationListCondition,
  DrizzleOrganizationRepository,
  type OrganizationListQuery,
} from "./organization-repository";

const parentId = "10000000-0000-4000-8000-000000000001";
const childId = "20000000-0000-4000-8000-000000000001";

function listQuery(search: string): OrganizationListQuery {
  return {
    search,
    lastResort: "all",
    travelLegId: null,
    page: 1,
    pageSize: 50,
  };
}

function organization(
  id: string,
  name: string,
  parentOrganizationId: string | null,
  city: string | null,
) {
  return {
    id,
    name,
    actRecordId: null,
    placeType: "other" as const,
    phone: id === childId ? "512-555-0100" : null,
    normalizedPhone: null,
    address1: null,
    address2: null,
    city,
    region: city ? "TX" : null,
    postalCode: null,
    website: id === parentId ? "https://example.com" : null,
    parentOrganizationId,
    lastResort: false,
    lastResortReason: null,
    lastResortChangedAt: null,
    createdAt: new Date("2026-08-13T00:00:00.000Z"),
    updatedAt: new Date("2026-08-13T00:00:00.000Z"),
  };
}

const parent = organization(parentId, "Adventure Zone", null, null);
const child = organization(
  childId,
  "Adventure Zone Austin",
  parentId,
  "Austin",
);

function render(statement: SQL) {
  const rendered = new PgDialect().sqlToQuery(statement);
  return {
    sql: rendered.sql.toLowerCase().replace(/\s+/g, " "),
    params: rendered.params,
  };
}

function renderCondition(search: string) {
  const condition = buildOrganizationListCondition(listQuery(search));
  expect(condition).toBeDefined();
  return render(condition!);
}

class ListQueryBuilder {
  constructor(
    private readonly database: TestDatabase,
    private readonly selection: Record<string, unknown> | undefined,
  ) {}

  from(_table: unknown) {
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
      return [{ value: this.database.resultOrganizations.length }];
    }
    if (!this.selection) {
      return this.database.resultOrganizations;
    }
    if (keys.includes("id") && keys.includes("name") && keys.includes("website")) {
      return this.database.allOrganizations
        .filter((record) => record.parentOrganizationId === null)
        .map((record) => ({
          id: record.id,
          name: record.name,
          website: record.website,
        }));
    }
    if (keys.includes("parentOrganizationId") && keys.includes("value")) {
      const counts = new Map<string, number>();
      for (const record of this.database.allOrganizations) {
        if (record.parentOrganizationId) {
          counts.set(
            record.parentOrganizationId,
            (counts.get(record.parentOrganizationId) ?? 0) + 1,
          );
        }
      }
      return [...counts].map(([parentOrganizationId, value]) => ({
        parentOrganizationId,
        value,
      }));
    }
    if (
      keys.includes("organizationId") &&
      keys.includes("firstName") &&
      keys.includes("lastName")
    ) {
      return [
        {
          organizationId: childId,
          firstName: "Morgan",
          lastName: "Lee",
        },
      ];
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

  constructor(
    readonly resultOrganizations: Array<typeof parent>,
    readonly allOrganizations: Array<typeof parent>,
  ) {}

  select(selection?: Record<string, unknown>) {
    return new ListQueryBuilder(this, selection);
  }

  asApplicationDatabase() {
    return this as unknown as typeof ApplicationDatabase;
  }
}

async function listWith(
  search: string,
  resultOrganizations: Array<typeof parent>,
) {
  const database = new TestDatabase(resultOrganizations, [parent, child]);
  const page = await new DrizzleOrganizationRepository(
    database.asApplicationDatabase(),
  ).listOrganizations(listQuery(search));
  return { database, page };
}

describe("frontend hierarchy-aware organization repository", () => {
  it("returns only root profiles for an empty search", async () => {
    const rendered = renderCondition("");
    const { page } = await listWith("", [parent]);

    expect(rendered.sql).toContain(
      '"organizations"."parent_organization_id" is null',
    );
    expect(page.records).toEqual([
      expect.objectContaining({
        id: parentId,
        parent: null,
        locationCount: 1,
      }),
    ]);
  });

  it.each([
    ["city", "Austin", '"organizations"."city" ilike'],
    ["local contact", "Morgan Lee", "concat_ws"],
    ["phone", "512-555-0100", "person.phone ilike"],
    ["email", "morgan@example.com", "person.email ilike"],
  ])("returns a child discovered by %s", async (_field, search, clause) => {
    const rendered = renderCondition(search);
    const { page } = await listWith(search, [child]);

    expect(rendered.sql).toContain(clause);
    expect(rendered.sql).toContain("association.active");
    expect(rendered.params).toContain(`%${search}%`);
    expect(page.records).toEqual([
      expect.objectContaining({
        id: childId,
        parent: {
          id: parentId,
          name: "Adventure Zone",
          website: "https://example.com",
        },
        locationCount: 0,
      }),
    ]);
  });

  it("ranks a direct parent match first and returns hierarchy metadata", async () => {
    const { database, page } = await listWith("Adventure Zone", [
      parent,
      child,
    ]);

    const firstOrder = render(database.orderExpressions[0]![0] as SQL).sql;
    expect(firstOrder).toContain(
      'case when lower("organizations"."name") = lower($1) then 0',
    );
    expect(firstOrder).toContain(
      'when "organizations"."parent_organization_id" is null then 1 else 2 end',
    );
    expect(page.records).toEqual([
      expect.objectContaining({
        id: parentId,
        parent: null,
        locationCount: 1,
      }),
      expect.objectContaining({
        id: childId,
        parent: {
          id: parentId,
          name: "Adventure Zone",
          website: "https://example.com",
        },
        locationCount: 0,
      }),
    ]);
  });
});
