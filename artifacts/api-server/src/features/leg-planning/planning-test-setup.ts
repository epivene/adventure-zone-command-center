// Explicit local/CI fixtures only; never import this file from product code.
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  actors,
  completeFacts,
  draft,
  fixtureWindow,
  ids,
  source,
} from "./planning-fixtures";
import { LegPlanningService } from "./planning-service";
import { withAllocationTransaction } from "../outreach-planner/outreach-allocation";
import { finishCapacityWriteIn } from "../outreach-planner/outreach-commitments";
export const secondWorker = "00000000-0000-4000-8000-000000000021",
  secondResource = "00000000-0000-4000-8000-000000000022",
  secondSet = "00000000-0000-4000-8000-000000000023",
  secondLeg = "00000000-0000-4000-8000-000000000024";
export const secondFixtureSql = `INSERT INTO crew_workers VALUES('${secondWorker}','Second fixture worker','rehirable');
INSERT INTO resources(id,name,category,status) VALUES('${secondResource}','Second fixture pool','Pool','available');
INSERT INTO travel_legs(id,name) VALUES('${secondLeg}','Second fixture leg');
INSERT INTO bookings(id,name,status,travel_leg_id,starts_at,ends_at,latitude,longitude) VALUES('${ids.otherBooking}','Second fixture fair','new_lead','${secondLeg}','2027-07-21T12:00Z','2027-07-26T12:00Z',41,-112);
INSERT INTO booking_package_selections VALUES('${ids.otherBooking}','${ids.package}');
UPDATE bookings SET status='new_lead';`;
export async function readyPlans(
  service: LegPlanningService,
  specs: Array<{
    bookingId: string;
    legId: string;
    workerId: string;
    resourceId: string;
    setId: string;
  }>,
) {
  await withAllocationTransaction(
    service.database,
    async (tx) => {
      for (const legId of new Set(specs.map((s) => s.legId))) {
        const { revision: _, ...base } = completeFacts().season!;
        const season = {
          ...base,
          legId,
          managerWorkerId: specs.find((s) => s.legId === legId)!.workerId,
          workerIds: specs
            .filter((s) => s.legId === legId)
            .map((s) => s.workerId),
          baseAddress: "Fixture office base",
        };
        await tx.execute(
          sql`INSERT INTO leg_season_plans(leg_id,season_year,payload) VALUES(${legId}::uuid,2027,${JSON.stringify(season)}::jsonb)`,
        );
      }
      for (const s of specs) {
        const availability = {
          id: randomUUID(),
          workerId: s.workerId,
          window: fixtureWindow,
          state: "confirmed",
          source,
          revision: 1,
        };
        await tx.execute(
          sql`INSERT INTO crew_availability(id,worker_id,starts_at,ends_at,state,payload) VALUES(${availability.id}::uuid,${s.workerId}::uuid,'2027-07-21T12:00Z','2027-07-26T12:00Z','confirmed',${JSON.stringify(availability)}::jsonb)`,
        );
        const set = {
          ...completeFacts().packageSets[0],
          id: s.setId,
          resourceIds: [s.resourceId],
        };
        await tx.execute(
          sql`INSERT INTO package_sets(id,package_id,payload) VALUES(${s.setId}::uuid,${ids.package}::uuid,${JSON.stringify(set)}::jsonb)`,
        );
        await tx.execute(
          sql`INSERT INTO package_set_members VALUES(${s.setId}::uuid,${s.resourceId}::uuid)`,
        );
      }
      await finishCapacityWriteIn(tx);
    },
    { mode: "commitment", source: "local-test-fixtures" },
  );
  for (const s of specs) {
    const payload = draft({
      bookingId: s.bookingId,
      legId: s.legId,
      packageSetIds: [s.setId],
      crew: [
        {
          workerId: s.workerId,
          role: "operator",
          window: fixtureWindow,
          state: "confirmed",
        },
      ],
      loadInAddress: "Fixture gate",
    });
    const saved = await service.saveDraft(actors.owner, {
      payload,
      requestKey: `draft-${s.bookingId}`,
      expectedRevision: null,
    });
    const [f] = await service.facts(s.bookingId, actors.owner);
    await service.saveDraft(actors.owner, {
      payload: {
        ...payload,
        travelReview: {
          endpointFingerprint: f.travel.endpointFingerprint,
          source,
        },
      },
      requestKey: `review-${s.bookingId}`,
      expectedRevision: saved.value.revision,
    });
  }
}
