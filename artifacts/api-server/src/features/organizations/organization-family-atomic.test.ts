import { describe, expect, it } from "vitest";

import {
  auditEntries,
  organizationFamilyReviews,
  organizations,
} from "@/db/schema";
import {
  reviewOrganizationFamily,
} from "./organization-repository";
import { HierarchyConflictError } from "./organization-hierarchy";

const FIRST_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_ID = "22222222-2222-4222-8222-222222222222";
const PARENT_ID = "33333333-3333-4333-8333-333333333333";
const GROUP_KEY = `organization-family:${FIRST_ID}|${SECOND_ID}`;

function sqlParameters(value: unknown, seen = new Set<unknown>()): unknown[] {
  if (!value || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  if ("value" in value && value.constructor?.name === "Param") {
    return [(value as { value: unknown }).value];
  }
  if (Array.isArray(value)) return value.flatMap((item) => sqlParameters(item, seen));
  if ("queryChunks" in value) {
    return sqlParameters((value as { queryChunks: unknown[] }).queryChunks, seen);
  }
  return [];
}

type State = {
  organizations: Array<Record<string, unknown>>;
  review: null | {
    groupKey: string;
    candidateIds: string[];
    status: "proposed" | "not_related";
    evidence: unknown[];
  };
};

class AtomicFamilyDatabase {
  state: State = {
    organizations: [
      {
        id: FIRST_ID,
        name: "Water Lantern Festival",
        website: null,
        address1: "100 Lake St",
        city: "Denver",
        region: "CO",
        postalCode: null,
        parentOrganizationId: null,
      },
      {
        id: SECOND_ID,
        name: "Water Lantern Festival",
        website: null,
        address1: "200 River Rd",
        city: "Austin",
        region: "TX",
        postalCode: null,
        parentOrganizationId: null,
      },
    ],
    review: {
      groupKey: GROUP_KEY,
      candidateIds: [FIRST_ID, SECOND_ID],
      status: "proposed",
      evidence: [],
    },
  };
  failReviewDelete = false;

  async transaction<T>(
    work: (transaction: AtomicFamilyTransaction) => Promise<T>,
    _config?: unknown,
  ): Promise<T> {
    const snapshot = structuredClone(this.state);
    try {
      return await work(new AtomicFamilyTransaction(this));
    } catch (error) {
      this.state = snapshot;
      throw error;
    }
  }
}

class AtomicFamilyTransaction {
  constructor(private readonly database: AtomicFamilyDatabase) {}

  select(selection?: Record<string, unknown>) {
    let table: unknown;
    let condition: unknown;
    const builder = {
      from: (selectedTable: unknown) => {
        table = selectedTable;
        return builder;
      },
      where: (selectedCondition: unknown) => {
        condition = selectedCondition;
        return builder;
      },
      orderBy: (..._columns: unknown[]) => builder,
      for: (_lock: string) => {
        if (table === organizationFamilyReviews) {
          return Promise.resolve(this.database.state.review ? [this.database.state.review] : []);
        }
        if (table === organizations) {
          const keys = Object.keys(selection ?? {});
          if (keys.length === 1 && keys[0] === "parentOrganizationId") {
            const parentIds = new Set(sqlParameters(condition));
            return Promise.resolve(
              this.database.state.organizations
                .filter((row) => parentIds.has(row.parentOrganizationId))
                .map((row) => ({ parentOrganizationId: row.parentOrganizationId })),
            );
          }
          const ids = new Set(sqlParameters(condition));
          const records = this.database.state.organizations.filter((row) =>
            ids.size === 0 ? row.parentOrganizationId === null : ids.has(row.id),
          );
          return Promise.resolve(records);
        }
        return Promise.resolve([]);
      },
    };
    return builder;
  }

  execute(_statement: unknown) {
    return Promise.resolve({ rows: [] });
  }

  insert(table: unknown) {
    return {
      values: (values: Record<string, unknown>) => {
        if (table === organizations) {
          const parent = { id: PARENT_ID, parentOrganizationId: null, ...values };
          this.database.state.organizations.push(parent);
          return {
            returning: (_selection: unknown) => Promise.resolve([{ id: PARENT_ID }]),
          };
        }
        if (table === auditEntries) return Promise.resolve();
        return {
          returning: (_selection: unknown) => Promise.resolve([]),
        };
      },
    };
  }

  update(table: unknown) {
    return {
      set: (values: Record<string, unknown>) => ({
        where: (condition: unknown) => {
          if (table === organizations) {
            const ids = new Set(sqlParameters(condition));
            for (const organization of this.database.state.organizations) {
              if (ids.has(organization.id)) Object.assign(organization, values);
            }
          } else if (table === organizationFamilyReviews && this.database.state.review) {
            Object.assign(this.database.state.review, values);
          }
          return Promise.resolve();
        },
      }),
    };
  }

  delete(table: unknown) {
    return {
      where: (_condition: unknown) => {
        if (table === organizationFamilyReviews) {
          if (this.database.failReviewDelete) {
            throw new Error("review delete failed");
          }
          this.database.state.review = null;
        }
        return Promise.resolve();
      },
    };
  }
}

const input = {
  action: "make_locations" as const,
  candidateIds: [FIRST_ID, SECOND_ID],
  parent: { kind: "new" as const, name: "Water Lantern Festival" },
};

describe("atomic organization family review", () => {
  it("rolls back the parent and child moves when proposal deletion fails", async () => {
    const database = new AtomicFamilyDatabase();
    database.failReviewDelete = true;

    await expect(
      reviewOrganizationFamily(database as never, input, new Date("2026-08-13T00:00:00Z")),
    ).rejects.toThrow("review delete failed");

    expect(database.state.organizations).toHaveLength(2);
    expect(database.state.organizations.map((row) => row.parentOrganizationId)).toEqual([
      null,
      null,
    ]);
    expect(database.state.review?.status).toBe("proposed");
  });

  it("serializes repeated create-parent decisions without creating an empty second parent", async () => {
    const database = new AtomicFamilyDatabase();

    await reviewOrganizationFamily(
      database as never,
      input,
      new Date("2026-08-13T00:00:00Z"),
    );
    await expect(
      reviewOrganizationFamily(
        database as never,
        input,
        new Date("2026-08-13T00:00:01Z"),
      ),
    ).rejects.toBeInstanceOf(HierarchyConflictError);

    expect(database.state.organizations.filter((row) => row.id === PARENT_ID)).toHaveLength(1);
    expect(
      database.state.organizations
        .filter((row) => row.id === FIRST_ID || row.id === SECOND_ID)
        .map((row) => row.parentOrganizationId),
    ).toEqual([PARENT_ID, PARENT_ID]);
  });
});
