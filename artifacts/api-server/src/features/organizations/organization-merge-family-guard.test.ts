import { PgDialect } from "drizzle-orm/pg-core";
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
  persistProposedOrganizationFamilies,
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
  name: string;
  website: string | null;
  address1: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  parentOrganizationId: string | null;
};

type ProposalRow = {
  groupKey: string;
  candidateIds: string[];
};

class GuardTransaction {
  readonly locks: string[] = [];
  readonly insertedProposals: unknown[] = [];
  readonly mutations: Array<{
    kind: "execute" | "update" | "delete";
    table?: unknown;
    values?: Record<string, unknown>;
  }> = [];
  private organizationSelectIndex = 0;

  constructor(
    private readonly selected: OrganizationRow[],
    private readonly ownedLocations: OrganizationRow[] = [],
    private readonly proposals: ProposalRow[] = [],
  ) {}

  select(_selection?: Record<string, unknown>) {
    let table: unknown;
    const builder = {
      from: (selectedTable: unknown) => {
        table = selectedTable;
        return builder;
      },
      where: (_condition: unknown) => builder,
      orderBy: (..._columns: unknown[]) => builder,
      for: (lock: string) => {
        this.locks.push(lock);
        if (table === organizationFamilyReviews) {
          return Promise.resolve(this.proposals);
        }
        if (table === organizations) {
          const rows = this.organizationSelectIndex++ === 0
            ? this.selected
            : this.ownedLocations;
          return Promise.resolve(rows);
        }
        return Promise.resolve([]);
      },
    };
    return builder;
  }

  insert(table: unknown) {
    return {
      values: (values: unknown[]) => ({
        onConflictDoNothing: (_options: unknown) => {
          if (table === organizationFamilyReviews) {
            this.insertedProposals.push(...values);
            for (const value of values as ProposalRow[]) {
              if (!this.proposals.some((proposal) => proposal.groupKey === value.groupKey)) {
                this.proposals.push({
                  groupKey: value.groupKey,
                  candidateIds: value.candidateIds,
                });
              }
            }
          }
          return Promise.resolve();
        },
      }),
    };
  }

  execute(statement: unknown) {
    try {
      const rendered = new PgDialect().sqlToQuery(statement as never).sql.toLowerCase();
      if (rendered.includes("company_contact")) {
        return Promise.resolve({ rows: [] });
      }
    } catch {
      // Mutation SQL is recorded below.
    }
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

function row(
  id: string,
  parentOrganizationId: string | null = null,
  overrides: Partial<OrganizationRow> = {},
): OrganizationRow {
  return {
    id,
    name: "Ordinary duplicate",
    website: null,
    address1: null,
    city: "Denver",
    region: "CO",
    postalCode: null,
    parentOrganizationId,
    ...overrides,
  };
}

function currentFamilyRows(): OrganizationRow[] {
  return [
    row(PRIMARY_ID, null, {
      name: "Water Lantern Festival - Denver, CO",
      website: "https://waterlanternfestival.com/denver",
      address1: "100 Lake St",
      city: "Denver",
      region: "CO",
    }),
    row(DUPLICATE_ID, null, {
      name: "Water Lantern Festival - Austin, TX",
      website: "https://waterlanternfestival.com/austin",
      address1: "200 River Rd",
      city: "Austin",
      region: "TX",
    }),
  ];
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
        [
          ...currentFamilyRows(),
          row(OTHER_ID, null, {
            name: "Water Lantern Festival - Boston, MA",
            website: "https://waterlanternfestival.com/boston",
            address1: "300 Harbor Rd",
            city: "Boston",
            region: "MA",
          }),
        ],
        [],
        [{
          groupKey: `organization-family:${DUPLICATE_ID}|${OTHER_ID}`,
          candidateIds: [DUPLICATE_ID, OTHER_ID],
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

  it("serializes proposal persistence with merges through the same candidate locks", async () => {
    const proposal = {
      normalizedName: "lantern festival",
      city: "",
      region: "",
      classification: "location_candidate" as const,
      groupKey: `organization-family:${PRIMARY_ID}|${DUPLICATE_ID}`,
      candidateIds: [PRIMARY_ID, DUPLICATE_ID],
      evidence: [
        { family: "website" as const, label: "website domains agree" },
      ],
    };

    // Proposal wins the candidate locks: it commits first, so the waiting merge
    // observes the proposal and is rejected.
    const proposalWinner = new GuardTransaction([
      row(PRIMARY_ID),
      row(DUPLICATE_ID),
    ]);
    await persistProposedOrganizationFamilies(
      {
        transaction: async (work: (tx: GuardTransaction) => Promise<void>) =>
          work(proposalWinner),
      } as never,
      [proposal],
    );
    expect(proposalWinner.locks).toEqual(["update", "update"]);
    expect(proposalWinner.insertedProposals).toEqual([
      expect.objectContaining({
        groupKey: proposal.groupKey,
        candidateIds: [PRIMARY_ID, DUPLICATE_ID],
        status: "proposed",
      }),
    ]);

    const mergeAfterProposal = new GuardTransaction(
      [row(PRIMARY_ID), row(DUPLICATE_ID)],
      [],
      [{ groupKey: proposal.groupKey, candidateIds: proposal.candidateIds }],
    );
    await expectConflict(mergeAfterProposal);

    // Merge wins the same candidate locks: after its deletion commits, the
    // proposal transaction sees a missing candidate and creates no stale row.
    const proposalAfterMerge = new GuardTransaction([row(PRIMARY_ID)]);
    await persistProposedOrganizationFamilies(
      {
        transaction: async (work: (tx: GuardTransaction) => Promise<void>) =>
          work(proposalAfterMerge),
      } as never,
      [proposal],
    );
    expect(proposalAfterMerge.insertedProposals).toEqual([]);
  });

  it("deletes a stale website proposal and allows the ordinary merge", async () => {
    const proposalKey = `organization-family:${PRIMARY_ID}|${DUPLICATE_ID}`;
    const transaction = new GuardTransaction(
      [
        row(PRIMARY_ID, null, {
          name: "Lantern Denver",
          website: "https://denver.example",
          address1: "100 Lake St",
          city: "Denver",
          region: "CO",
        }),
        row(DUPLICATE_ID, null, {
          name: "Lantern Austin",
          website: "https://austin.example",
          address1: "200 River Rd",
          city: "Austin",
          region: "TX",
        }),
      ],
      [],
      [{ groupKey: proposalKey, candidateIds: [PRIMARY_ID, DUPLICATE_ID] }],
    );

    await assertOrganizationsMergeable(
      transaction as never,
      [PRIMARY_ID, DUPLICATE_ID],
    );

    expect(transaction.mutations).toContainEqual({
      kind: "delete",
      table: organizationFamilyReviews,
    });
  });

  it("deletes stale same-address and disconnected-ACT proposals before merge", async () => {
    const proposalKey = `organization-family:${PRIMARY_ID}|${DUPLICATE_ID}`;
    for (const records of [
      [
        row(PRIMARY_ID, null, { name: "Lantern One", website: "https://shared.example", address1: "100 Lake St", city: "Denver", region: "CO" }),
        row(DUPLICATE_ID, null, { name: "Lantern Two", website: "https://shared.example", address1: "100 Lake St", city: "Austin", region: "TX" }),
      ],
      [
        row(PRIMARY_ID, null, { name: "Lantern One", website: "https://shared.example", address1: "100 Lake St", city: "Denver", region: "CO" }),
        row(DUPLICATE_ID, null, { name: "Lantern Two", website: "https://shared.example", address1: "200 River Rd", city: "Austin", region: "TX" }),
      ],
    ]) {
      const transaction = new GuardTransaction(
        records,
        [],
        [{ groupKey: proposalKey, candidateIds: [PRIMARY_ID, DUPLICATE_ID] }],
      );
      await assertOrganizationsMergeable(
        transaction as never,
        [PRIMARY_ID, DUPLICATE_ID],
      );
      expect(transaction.mutations).toContainEqual({
        kind: "delete",
        table: organizationFamilyReviews,
      });
    }
  });

});
