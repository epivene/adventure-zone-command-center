import { describe, expect, it } from "vitest";

import {
  DrizzleCallWorkspaceContextRepository,
  lastContactedParents,
  type CallWorkspaceContext,
} from "./call-workspace-context";

const context: CallWorkspaceContext = {
  organization: { id: "10000000-0000-4000-8000-000000000001", name: "Acme Venue", lastResort: false, lastResortReason: null },
  contact: { id: "20000000-0000-4000-8000-000000000001", organizationId: "10000000-0000-4000-8000-000000000001", firstName: "Avery", lastName: "Lee", email: null, phone: null, city: null, region: null },
  booking: { id: "30000000-0000-4000-8000-000000000001", organizationId: "10000000-0000-4000-8000-000000000001", primaryContactId: "20000000-0000-4000-8000-000000000001", name: "Fall Festival", city: "Fargo", region: "ND", status: "interested", startsAt: null },
  followUp: null,
};

function databaseWith(
  calls: Array<{ endedAt: Date | null }>,
  activities: Array<{ occurredAt: Date | null }>,
) {
  const queryCounts = { calls: 0, activities: 0 };
  return {
    queryCounts,
    database: {
      select(selection: Record<string, unknown>) {
        const isCall = "endedAt" in selection;
        if (isCall) queryCounts.calls += 1;
        else queryCounts.activities += 1;
        const rows = isCall ? calls : activities;
        return {
          from: () => ({
            where: () => ({
              orderBy: () => ({
                limit: async () => rows,
              }),
            }),
          }),
        };
      },
    },
  };
}

describe("call workspace last-contacted context", () => {
  it("queries every resolved booking, contact, and organization parent", async () => {
    expect(lastContactedParents(context)).toEqual([
      { bookingId: "30000000-0000-4000-8000-000000000001" },
      { contactId: "20000000-0000-4000-8000-000000000001" },
      { organizationId: "10000000-0000-4000-8000-000000000001" },
    ]);

    const store = databaseWith([], []);
    const repository = new DrizzleCallWorkspaceContextRepository(store.database as never);

    await expect(repository.findLastContactedAt(context)).resolves.toBeNull();
    expect(store.queryCounts).toEqual({ calls: 3, activities: 3 });
  });

  it("uses the later associated activity occurrence over a completed call", async () => {
    const store = databaseWith(
      [{ endedAt: new Date("2026-08-10T12:00:00.000Z") }],
      [{ occurredAt: new Date("2026-08-11T12:00:00.000Z") }],
    );
    const repository = new DrizzleCallWorkspaceContextRepository(store.database as never);

    await expect(repository.findLastContactedAt(context))
      .resolves.toEqual(new Date("2026-08-11T12:00:00.000Z"));
  });

  it("uses the later completed call end time over an associated activity", async () => {
    const store = databaseWith(
      [{ endedAt: new Date("2026-08-12T12:00:00.000Z") }],
      [{ occurredAt: new Date("2026-08-11T12:00:00.000Z") }],
    );
    const repository = new DrizzleCallWorkspaceContextRepository(store.database as never);

    await expect(repository.findLastContactedAt(context))
      .resolves.toEqual(new Date("2026-08-12T12:00:00.000Z"));
  });
});
