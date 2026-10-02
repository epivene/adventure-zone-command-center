import { vi } from "vitest";
import { actors } from "../leg-planning/planning-fixtures";
import { readyPlans } from "../leg-planning/planning-test-setup";
import { LegPlanningService } from "../leg-planning/planning-service";
import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { planningDatabase } from "../leg-planning/planning-test-database";
import { loadPlanFacts } from "../leg-planning/planning-facts";
import { ids } from "../leg-planning/planning-fixtures";
it("keeps an unverified committed date as a readiness obligation", async () => {
 const {pg,db}=await planningDatabase({reviewDates:false});
 try {
  await pg.exec(readFileSync(new URL("../../../../../lib/db/migrations/20261002_booking_date_provenance.sql",import.meta.url),"utf8"));
  const facts=await loadPlanFacts(db as any,[ids.booking],{kind:"owner",id:"owner"} as any,new Date("2027-01-01"));
  expect(facts[0].sourceReasons).toContain("UNRESOLVED_OBLIGATION_WINDOWS");
  expect(facts[0].booking.publicWindow).toBeNull();
 } finally {await pg.close();}
},30_000);

it("records the separately reviewed reservation when an operational plan commits",async()=>{
 vi.stubEnv("LEG_PLANNING_ENABLED","true");
 const {pg,db}=await planningDatabase();
 try {
  await pg.exec("DROP TRIGGER fixture_review_reservation_dates ON booking_operational_windows");
  const service=new LegPlanningService(db as any);
  await readyPlans(service,[{bookingId:ids.booking,legId:ids.leg,workerId:ids.worker,resourceId:ids.resource,setId:ids.set}]);
  const current=(await service.get(ids.booking,actors.owner))!.plan!;
  const result=await service.commitPlans(actors.owner,{bookingIds:[ids.booking],expectedRevisions:{[ids.booking]:current.revision},requestKey:"date-proof-commit"});
  const [facts]=await service.facts(ids.booking,actors.owner);
  expect(facts.sourceReasons).not.toContain("INVALID_BOOKING_WINDOW");
  expect((await pg.query<{count:number}>("select count(*)::int as count from booking_date_evidence where booking_id=$1 and kind='verified_reservation'",[ids.booking])).rows[0].count).toBe(2);
  expect((await pg.query<{source_id:string}>("select distinct source_id from booking_date_evidence where booking_id=$1 and kind='verified_reservation'",[ids.booking])).rows[0].source_id).toBe(result.receiptId);
 } finally {await pg.close();vi.unstubAllEnvs();}
},30_000);
