import { describe, expect, it } from "vitest";

import {
  activities,
  actExternalLinks,
  actMigrationRecords,
  bookings,
  callSessions,
  contacts,
  followUps,
  organizationContacts,
  organizationFamilyReviews,
  organizations,
} from "@/db/schema";
import { HierarchyConflictError } from "./organization-hierarchy";
import {
  assertOrganizationsMergeable,
  DrizzleOrganizationRepository,
} from "./organization-repository";

const PRIMARY_ID = "11111111-1111-4111-8111-111111111111";
const DUPLICATE_ID = "22222222-2222-4222-8222-222222222222";
const PARENT_ID = "33333333-3333-4333-8333-333333333333";
const CHILD_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_ID = "55555555-5555-4555-8555-555555555555";
const conflictMessage =
  "These profiles may be locations of the same organization. Review the location group before merging.";

type OrganizationRow = {
  id: string;
  parentOrganizationId: string | null;
};

type ProposalRow = {
  groupKey: string;
  candidateIds: string[];
};

class GuardTransaction {
  readonly locks: string[] = [];
  readonly mutations: Array<{
    kind: "execute" | "update" | "delete";
    table?: unknown;
    values?: Record<string, unknown>;
  }> = [];
  private selectIndex = 0;

  constructor(
    private readonly selected: OrganizationRow[],
    private readonly ownedLocations: OrganizationRow[] = [],
    private readonly proposals: ProposalRow[] = [],
  ) {}

  select() {
    const index = this.selectIndex++;
    const rows =
      index === 0
        ? this.selected
        : index === 1
          ? this.ownedLocations
          : this.proposals;
    const builder = {
      from: (_table: unknown) => builder,
      where: (_condition: unknown) => builder,
      orderBy: (..._columns: unknown[]) => builder,
      for: (lock: string) => {
        this.locks.push(lock);
        return Promise.resolve(rows);
      },
    };
    return builder;
  }

  execute(_statement: unknown) {
    this.mutations.push({ kind: "execute" });
    return Promise.resolve({ rows: [] });
  }

  update(table: unknown) {
    return {
      set: (values: Record<string, unknown>) => ({
        where: (_condition: unknown) => {
          this.mutations.push({ kind: "update", table, values });
          return Promise.resolve();
        },
      }),
    };
  }

  delete(table: unknown) {
    return {
      where: (_condition: unknown) => {
        this.mutations.push({ kind: "delete", table });
        return Promise.resolve();
      },
    };
  }
}

function row(id: string, parentOrganizationId: string | null = null): OrganizationRow {
  return { id, parentOrganizationId };
}

async function expectConflict(transaction: GuardTransaction) {
  await expect(
    assertOrganizationsMergeable(
      transaction as never,
      [PRIMARY_ID, DUPLICATE_ID],
    ),
  ).rejects.toEqual(new HierarchyConflictError(conflictMessage));
  expect(transaction.mutations).toEqual([]);
}

describe("organization merge family guard", () => {
  it("rejects a parent and child", async () => {
    await expectConflict(
      new GuardTransaction([
        row(PRIMARY_ID),
        row(DUPLICATE_ID, PRIMARY_ID),
      ]),
    );
  });

  it("rejects two sibling locations", async () => {
    await expectConflict(
      new GuardTransaction([
        row(PRIMARY_ID, PARENT_ID),
        row(DUPLICATE_ID, PARENT_ID),
      ]),
    );
  });

  it("rejects any selected profile in a current proposed family review", async () => {
    await expectConflict(
      new GuardTransaction(
        [row(PRIMARY_ID), row(DUPLICATE_ID)],
        [],
        [{
          groupKey: "organization-family:proposal",
          candidateIds: [OTHER_ID, DUPLICATE_ID],
        }],
      ),
    );
  });

  it("rejects when the primary owns children", async () => {
    await expectConflict(
      new GuardTransaction(
        [row(PRIMARY_ID), row(DUPLICATE_ID)],
        [row(CHILD_ID, PRIMARY_ID)],
      ),
    );
  });

  it("rejects when a duplicate owns children", async () => {
    await expectConflict(
      new GuardTransaction(
        [row(PRIMARY_ID), row(DUPLICATE_ID)],
        [row(CHILD_ID, DUPLICATE_ID)],
      ),
    );
  });

  it("allows ordinary duplicates and preserves the existing relationship re-parenting", async () => {
    const transaction = new GuardTransaction(
      [row(PRIMARY_ID), row(DUPLICATE_ID)],
      [],
      [{
        groupKey: "organization-family:unrelated",
        candidateIds: [OTHER_ID, CHILD_ID],
      }],
    );
    const database = {
      transaction: async <T>(work: (tx: GuardTransaction) => Promise<T>) =>
        work(transaction),
    };
    const repository = new DrizzleOrganizationRepository(database as never);

    await repository.mergeOrganizations(PRIMARY_ID, [DUPLICATE_ID]);

    expect(transaction.locks).toEqual(["update", "update", "update"]);
    expect(transaction.mutations[0]).toEqual({ kind: "execute" });
    for (const table of [
      contacts,
      bookings,
      followUps,
      activities,
      callSessions,
      actExternalLinks,
      actMigrationRecords,
    ]) {
      expect(transaction.mutations).toContainEqual(
        expect.objectContaining({ kind: "update", table }),
      );
    }
    expect(transaction.mutations).toContainEqual({
      kind: "delete",
      table: organizationContacts,
    });
    expect(transaction.mutations.at(-1)).toEqual({
      kind: "delete",
      table: organizations,
    });
  });

  it("locks all selected profiles before inspecting family state", async () => {
    const transaction = new GuardTransaction([
      row(PRIMARY_ID),
      row(DUPLICATE_ID),
    ]);

    await assertOrganizationsMergeable(
      transaction as never,
      [DUPLICATE_ID, PRIMARY_ID, DUPLICATE_ID],
    );

    expect(transaction.locks).toEqual(["update", "update", "update"]);
  });
});
