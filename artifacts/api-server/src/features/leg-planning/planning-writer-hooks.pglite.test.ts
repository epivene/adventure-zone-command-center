import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { planningDatabase } from "./planning-test-database";
import { actors, draft, ids, completeFacts } from "./planning-fixtures";
import { LegPlanningService } from "./planning-service";
import {
  commitmentTransaction,
  reconcileCapacityFacts,
} from "../outreach-planner/outreach-commitments";
import { withAllocationTransaction } from "../outreach-planner/outreach-allocation";
let fixture: Awaited<ReturnType<typeof planningDatabase>>;
beforeEach(async () => {
  vi.stubEnv("LEG_PLANNING_ENABLED", "true");
  vi.stubEnv("OUTREACH_PLANNER_ENABLED", "false");
  fixture = await planningDatabase();
  const set = completeFacts().packageSets[0];
  await fixture.pg.query(
    "INSERT INTO package_sets(id,package_id,payload) VALUES($1,$2,$3)",
    [set.id, set.packageId, JSON.stringify(set)],
  );
  await fixture.pg.query(
    "INSERT INTO booking_resource_assignments(booking_id,resource_id) VALUES($1,$2)",
    [ids.booking, ids.resource],
  );
  await new LegPlanningService(fixture.db as never).saveDraft(actors.owner, {
    payload: draft(),
    expectedRevision: null,
    requestKey: "draft",
  });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fixture?.pg.close();
});
it("invalidates a manual date/leg change under the shared lock while retaining customer status", async () => {
  await commitmentTransaction(
    fixture.db as never,
    async (tx) => {
      await tx.execute(
        sql`UPDATE bookings SET starts_at='2027-07-20T12:00Z' WHERE id=${ids.booking}::uuid`,
      );
    },
    { source: "booking-manual-edit", bookingIds: [ids.booking] },
  );
  expect((await fixture.pg.query("SELECT status FROM bookings")).rows).toEqual([
    { status: "confirmed" },
  ]);
  const plan = (await new LegPlanningService(fixture.db as never).get(
    ids.booking,
    actors.owner,
  ))!.plan!;
  expect(plan.invalidationReasons).toHaveLength(1);
  expect(plan.revision).toBe(2);
});
it.each(["resource-inventory", "calendar-sync"] as const)(
  "records factual %s reconciliation with outreach disabled",
  async (source) => {
    await reconcileCapacityFacts(fixture.db as never, source, async (tx) => {
      await tx.execute(sql`UPDATE resources SET status='maintenance'`);
    });
    expect(
      (
        await fixture.pg.query(
          "SELECT bool_and(validated) AS valid FROM outreach_write_receipts",
        )
      ).rows,
    ).toEqual([{ valid: true }]);
    expect(
      (
        await new LegPlanningService(fixture.db as never).get(
          ids.booking,
          actors.owner,
        )
      )?.readiness.overall,
    ).toBe("conflict");
  },
);
it.each(["booking-resource", "trip-resource", "active-hold"])(
  "rejects a conflicting %s allocation",
  async (kind) => {
    await fixture.pg.query(
      `INSERT INTO bookings(id,name,status,travel_leg_id,starts_at,ends_at) VALUES($1,'Other','confirmed',NULL,'2027-07-21T12:00Z','2027-07-26T12:00Z')`,
      [ids.otherBooking],
    );
    const write = async (tx: any) => {
      if (kind === "booking-resource")
        await tx.execute(
          sql`INSERT INTO booking_resource_assignments(booking_id,resource_id) VALUES(${ids.otherBooking}::uuid,${ids.resource}::uuid)`,
        );
      if (kind === "trip-resource") {
        await tx.execute(
          sql`INSERT INTO trips(id,travel_leg_id,start_date,end_date) VALUES(${ids.otherBooking}::uuid,NULL,'2027-07-21T12:00Z','2027-07-26T12:00Z')`,
        );
        await tx.execute(
          sql`INSERT INTO trip_resource_assignments VALUES(${ids.otherBooking}::uuid,${ids.resource}::uuid)`,
        );
      }
      if (kind === "active-hold")
        await tx.execute(
          sql`INSERT INTO outreach_holds VALUES(${ids.split}::uuid,${ids.otherBooking}::uuid,NULL,'2027-07-21','2027-07-26',${JSON.stringify([ids.resource])}::jsonb,${JSON.stringify({ pirates_rebellion: 1 })}::jsonb,'active','2090-01-01')`,
        );
    };
    const operation =
      kind === "active-hold"
        ? withAllocationTransaction(fixture.db as never, write)
        : commitmentTransaction(fixture.db as never, write, { source: kind });
    await expect(operation).rejects.toMatchObject({
      code: "PLANNING_CONFLICT",
    });
    expect(
      (
        await fixture.pg.query(
          "SELECT count(*)::int AS n FROM booking_resource_assignments",
        )
      ).rows,
    ).toEqual([{ n: 1 }]);
  },
);
it("guards direct writes and validates the participation receipt before transaction completion", async () => {
  await fixture.pg.exec("SET outreach.enforced='true'");
  await expect(
    fixture.pg.query("UPDATE leg_event_plans SET revision=revision+1"),
  ).rejects.toThrow(/participation/);
  await expect(
    fixture.pg.exec(
      "BEGIN; INSERT INTO outreach_write_receipts(transaction_id,mode,source) VALUES(txid_current(),'commitment','unvalidated'); UPDATE leg_event_plans SET revision=revision+1; COMMIT;",
    ),
  ).rejects.toThrow(/validation incomplete/);
  await fixture.pg.exec("ROLLBACK");
});
