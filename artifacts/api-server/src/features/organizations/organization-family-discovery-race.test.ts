import { describe, expect, it } from "vitest";

import {
  organizationFamilyReviews,
  organizations,
} from "@/db/schema";
import { DrizzleOrganizationRepository } from "./organization-repository";

const FIRST_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_ID = "22222222-2222-4222-8222-222222222222";
const GROUP_KEY = `organization-family:${FIRST_ID}|${SECOND_ID}`;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class DiscoverySnapshotDatabase {
  readonly snapshotTaken = deferred();
  readonly releaseSnapshot = deferred();
  readonly reviews: Array<Record<string, unknown>> = [];
  deleteCount = 0;
  private executeCount = 0;

  async execute() {
    if (this.executeCount++ === 0) {
      this.snapshotTaken.resolve();
      await this.releaseSnapshot.promise;
    }
    return { rows: [] };
  }

  select() {
    let table: unknown;
    const builder = {
      from: (selectedTable: unknown) => {
        table = selectedTable;
        return builder;
      },
      where: (_condition: unknown) => builder,
      orderBy: (..._columns: unknown[]) => builder,
      then: <TResult1 = unknown[], TResult2 = never>(
        onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) => Promise.resolve(
        table === organizationFamilyReviews
          ? [...this.reviews]
          : table === organizations
            ? []
            : [],
      ).then(onfulfilled, onrejected),
    };
    return builder;
  }

  delete(table: unknown) {
    return {
      where: (_condition: unknown) => {
        if (table === organizationFamilyReviews) {
          this.deleteCount += 1;
          this.reviews.splice(0);
        }
        return Promise.resolve();
      },
    };
  }
}

describe("organization family discovery snapshots", () => {
  it("does not let an older findDuplicates snapshot delete a newly persisted proposal", async () => {
    const database = new DiscoverySnapshotDatabase();
    const repository = new DrizzleOrganizationRepository(database as never);

    const discovery = repository.findDuplicates();
    await database.snapshotTaken.promise;
    database.reviews.push({
      groupKey: GROUP_KEY,
      candidateIds: [FIRST_ID, SECOND_ID],
      evidence: [],
      status: "proposed",
      updatedAt: new Date(),
    });
    database.releaseSnapshot.resolve();

    await expect(discovery).resolves.toEqual([]);
    expect(database.deleteCount).toBe(0);
    expect(database.reviews).toEqual([
      expect.objectContaining({
        groupKey: GROUP_KEY,
        status: "proposed",
      }),
    ]);
  });
});
