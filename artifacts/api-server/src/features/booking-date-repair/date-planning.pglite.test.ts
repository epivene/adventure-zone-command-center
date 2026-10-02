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
