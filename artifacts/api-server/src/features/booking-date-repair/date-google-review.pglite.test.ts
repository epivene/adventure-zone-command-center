import { parseOperationalEventDateText } from "../google-workspace/calendar/operational-calendar-matcher";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { getTableConfig } from "drizzle-orm/pg-core";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { it,expect,vi } from "vitest";
vi.hoisted(()=>{process.env.DATABASE_URL ||= "postgres://postgres:postgres@127.0.0.1:5432/test";});
import * as schema from "@/db/schema";
import { OperationalCalendarLinkRepository } from "../google-workspace/calendar/operational-calendar-link-repository";
it.each([null,"March 14 - 15, 2027"])("records reviewed Google reservation proof without inferring public dates (%s)",async(actualEventDateText)=>{
 vi.stubEnv("OUTREACH_PLANNER_ENABLED","false");vi.stubEnv("LEG_PLANNING_ENABLED","false");
 const pg=new PGlite();
 try {
  for(const table of [schema.bookings,schema.organizations,schema.travelLegs,schema.packageTemplates,schema.bookingPackageSelections,schema.bookingOperationalWindows,schema.googleOperationalCalendarLinks,schema.googleOperationalCalendarReviews]){
   const cfg=getTableConfig(table);
   await pg.exec(`CREATE TABLE "${cfg.name}" (${cfg.columns.map(col=>`"${col.name}" ${"enumValues" in col && col.enumValues ? "text":col.getSQLType()}${col.name==="id"?" PRIMARY KEY DEFAULT gen_random_uuid()":""}`).join(",")})`);
  }
  await pg.exec("ALTER TABLE booking_operational_windows ADD PRIMARY KEY(booking_id); CREATE UNIQUE INDEX fixture_calendar_source_identity ON google_operational_calendar_links(connection_id,calendar_id,booking_id,package_key);");
  await pg.exec(readFileSync(new URL("../../../../../lib/db/migrations/20261002_booking_date_provenance.sql",import.meta.url),"utf8"));
  await pg.query("insert into package_templates(code,name) values('adventure_zone','Zone')");
  const reviewId=randomUUID();
  await pg.query("insert into google_operational_calendar_reviews(id,connection_id,calendar_id,google_event_id,state,proposed_changes) values($1,$2,'calendar','event','pending',$3::jsonb)",[reviewId,randomUUID(),JSON.stringify({parsed:{packageKey:"zone",eventName:"Reviewed fair",city:"Denver",region:"CO",actualEventDateText},google:{startDate:"2027-03-13",endDateExclusive:"2027-03-16",etag:"version-1"}})]);
  const repo=new OperationalCalendarLinkRepository(drizzle(pg) as any);
  const result=await repo.resolveReview({reviewId,resolution:"create_new",reviewedBy:"owner"});
  const dates=(await pg.query<{dates:any}>("select booking_resolved_dates(b.id,b.starts_at,b.ends_at,w.starts_at,w.ends_at) as dates from bookings b join booking_operational_windows w on w.booking_id=b.id where b.id=$1",[result.bookingId])).rows[0].dates;
  expect(dates.reservationWindow).toEqual({start:"2027-03-13T07:00:00.000Z",end:"2027-03-16T06:00:00.000Z"});
  expect(dates.reservationEndExclusive).toBe(true);
  if(actualEventDateText) expect(dates.publicWindow).toEqual({start:"2027-03-14T07:00:00.000Z",end:"2027-03-16T05:59:59.999Z"});
  else expect(dates.publicWindow).toBeNull();
  expect(dates.endpointEvidence.every((e:any)=>e.sourceRef.id===reviewId)).toBe(true);
 } finally {await pg.close();vi.unstubAllEnvs();}
},30_000);

it("does not roll an impossible source event date into a different month",()=>{
 expect(parseOperationalEventDateText("February 30 - 31, 2027",2027)).toBeNull();
});
