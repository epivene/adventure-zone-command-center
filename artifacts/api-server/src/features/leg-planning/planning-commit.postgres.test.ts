import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { planningFixtureSql } from "./planning-test-database";
import {
  readyPlans,
  secondFixtureSql,
  secondLeg,
  secondSet,
  secondResource,
  secondWorker,
} from "./planning-test-setup";
import { ids, actors, fixtureWindow, source } from "./planning-fixtures";
import { LegPlanningService } from "./planning-service";
import { withAllocationTransaction } from "../outreach-planner/outreach-allocation";
import { finishCapacityWriteIn } from "../outreach-planner/outreach-commitments";
const url = process.env.LEG_PLANNING_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) ||
    !parsed.pathname.startsWith("/leg_planning_test")
  )
    throw new Error(
      "Use a disposable loopback leg_planning_test database only.",
    );
}
describe.skipIf(!url)("real PostgreSQL allocation serialization", () => {
  let admin: pg.Pool,
    pool: pg.Pool,
    schema: string,
    service: LegPlanningService;
  beforeEach(async () => {
    vi.stubEnv("LEG_PLANNING_ENABLED", "true");
    admin = new pg.Pool({ connectionString: url });
    schema = `leg_planning_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new pg.Pool({
      connectionString: url,
      options: `-c search_path=${schema},public -c outreach.enforced=true`,
      max: 4,
    });
    await pool.query(
      planningFixtureSql +
        secondFixtureSql +
        "CREATE TABLE outreach_candidates(checked_at timestamptz,source_snapshot jsonb);",
    );
    await pool.query(
      await readFile(
        new URL(
          "../../../../../lib/db/migrations/20261001_leg_planning.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    service = new LegPlanningService(drizzle(pool) as never);
    await readyPlans(service, [
      {
        bookingId: ids.booking,
        legId: ids.leg,
        workerId: ids.worker,
        resourceId: ids.resource,
        setId: ids.set,
      },
      {
        bookingId: ids.otherBooking,
        legId: secondLeg,
        workerId: ids.worker,
        resourceId: ids.resource,
        setId: secondSet,
      },
    ]);
  });
  afterEach(async () => {
    await pool?.end();
    if (schema) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin?.end();
    vi.unstubAllEnvs();
  });
  const commit = async (bookingId: string, key: string) => {
    const p = (await service.get(bookingId, actors.owner))!.plan!;
    return service.commitPlans(actors.owner, {
      bookingIds: [bookingId],
      expectedRevisions: { [bookingId]: p.revision },
      requestKey: key,
    });
  };
  it("rejects an unwrapped inventory write while planning enforcement is enabled", async () => {
    await expect(
      pool.query("UPDATE resources SET status='maintenance' WHERE id=$1", [
        ids.resource,
      ]),
    ).rejects.toThrow();
  });
  it("allows exactly one of two concurrent claims on the same worker and item", async () => {
    const results = await Promise.allSettled([
      commit(ids.booking, "a"),
      commit(ids.otherBooking, "b"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM leg_event_plans WHERE committed IS NOT NULL",
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it("serializes a competing active hold and plan commitment", async () => {
    const hold = withAllocationTransaction(service.database, async (tx) => {
      await tx.execute(
        sql`INSERT INTO outreach_holds VALUES(${ids.split}::uuid,${ids.otherBooking}::uuid,${secondLeg}::uuid,'2027-07-21','2027-07-26',${JSON.stringify([ids.resource])}::jsonb,${JSON.stringify({ pirates_rebellion: 1 })}::jsonb,'active','2030-01-01')`,
      );
      const { planningSnapshotIn, checkPlanningWriteIn } =
        await import("./planning-writer-hooks");
      // withAllocationTransaction performs its own planning check when rollout is enabled.
      const after = await planningSnapshotIn(tx);
      await checkPlanningWriteIn(tx, [], after, "commitment");
      await finishCapacityWriteIn(tx);
    });
    const results = await Promise.allSettled([hold, commit(ids.booking, "a")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
  it("rolls back a staged first branch after PostgreSQL rejects the second branch", async () => {
    await service.savePackageSet(actors.owner, {
      payload: {
        id: secondSet,
        packageId: ids.package,
        name: "Second actual pool",
        classification: "normal",
        resourceIds: [secondResource],
        requirements: { Pool: 1 },
        verify: true,
        source,
      },
      expectedRevision: 1,
      requestKey: "second-set",
    });
    await service.saveAvailability(actors.owner, {
      payload: {
        id: null,
        workerId: secondWorker,
        window: fixtureWindow,
        state: "confirmed",
        source,
      },
      expectedRevision: null,
      requestKey: "second-worker",
    });
    await withAllocationTransaction(
      service.database,
      async (tx) => {
        await tx.execute(
          sql`UPDATE bookings SET travel_leg_id=${ids.leg}::uuid WHERE id=${ids.otherBooking}::uuid`,
        );
        await finishCapacityWriteIn(tx);
      },
      { mode: "commitment", source: "local-fixture-parent" },
    );
    const group = await service.saveSplit(actors.owner, {
      payload: {
        id: null,
        parentLegId: ids.leg,
        bookingIds: [ids.booking, ids.otherBooking],
      },
      expectedRevision: null,
      requestKey: "split",
    });
    for (const bookingId of [ids.booking, ids.otherBooking]) {
      const p = (await service.get(bookingId, actors.owner))!.plan!;
      const d = {
        ...p.draft,
        legId: ids.leg,
        splitGroupId: group.value.id,
        crew:
          bookingId === ids.otherBooking
            ? [
                {
                  workerId: secondWorker,
                  role: "operator",
                  state: "confirmed" as const,
                  window: fixtureWindow,
                },
              ]
            : p.draft.crew,
      };
      const saved = await service.saveDraft(actors.owner, {
        payload: d,
        expectedRevision: p.revision,
        requestKey: `split-${bookingId}`,
      });
      const [f] = await service.facts(bookingId, actors.owner);
      await service.saveDraft(actors.owner, {
        payload: {
          ...saved.value.draft,
          travelReview: {
            endpointFingerprint: f.travel.endpointFingerprint,
            source,
          },
        },
        expectedRevision: saved.value.revision,
        requestKey: `split-review-${bookingId}`,
      });
    }
    await service.saveDaveAuthority(actors.owner, {
      payload: { accountId: ids.boss },
      expectedRevision: null,
      requestKey: "dave",
    });
    const request = await service.requestApproval(actors.owner, {
      payload: {
        type: "split",
        bookingIds: [ids.booking, ids.otherBooking],
        parentLegId: ids.leg,
      },
      expectedRevision: null,
      requestKey: "split-request",
    });
    await service.decideApproval(actors.dave, {
      payload: {
        requestId: request.value.id,
        decision: {
          decision: "approved",
          reason: "Reviewed disjoint staff and items",
          strategicAcknowledgement: false,
        },
      },
      expectedRevision: 1,
      requestKey: "split-decision",
    });
    await pool.query(
      `ALTER TABLE booking_resource_assignments ADD CONSTRAINT fixture_second_branch_failure CHECK(booking_id<>'${ids.otherBooking}')`,
    );
    const a = (await service.get(ids.booking, actors.owner))!.plan!,
      b = (await service.get(ids.otherBooking, actors.owner))!.plan!;
    await expect(
      service.commitPlans(actors.owner, {
        bookingIds: [ids.booking, ids.otherBooking],
        expectedRevisions: {
          [ids.booking]: a.revision,
          [ids.otherBooking]: b.revision,
        },
        requestKey: "two-branch",
      }),
    ).rejects.toThrow();
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM booking_resource_assignments",
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM leg_event_plans WHERE committed IS NOT NULL",
        )
      ).rows[0].n,
    ).toBe(0);
  });
});
