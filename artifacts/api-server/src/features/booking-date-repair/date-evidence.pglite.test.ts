import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { resolveBookingDates,dateEndpointInstant } from "./date-evidence";
const bookingId = "00000000-0000-4000-8000-000000000001";
describe("date provenance migration and SQL", () => {
  it("is additive, repeat-safe, and keeps sentinel imports out of effective overlap", async () => {
    const db = new PGlite();
    try {
      await db.exec("create table bookings(id uuid primary key, starts_at timestamptz, ends_at timestamptz); insert into bookings values ('"+bookingId+"','2026-03-01','9999-12-31');");
      const migration = await readFile(new URL("../../../../../lib/db/migrations/20261002_booking_date_provenance.sql", import.meta.url), "utf8");
      await db.exec(migration); await db.exec(migration);
      const raw = await db.query("select extract(year from ends_at)::int as year from bookings");
      expect(raw.rows).toEqual([{ year: 9999 }]);
      const resolved = await db.query<{value: any}>("select booking_resolved_dates(id, starts_at, ends_at, null, null) as value from bookings");
      expect(resolved.rows[0].value.publicWindow).toBeNull();
      expect(resolved.rows[0].value.evidenceState).toBe("needs_review");
    } finally { await db.close(); }
  }, 30_000);
  it("matches JavaScript for verified DST exclusive dates and rejects conflicting endpoints", async () => {
    const db = new PGlite();
    try {
      await db.exec("create table bookings(id uuid primary key, starts_at timestamptz, ends_at timestamptz); insert into bookings values ('"+bookingId+"',null,null);");
      await db.exec(await readFile(new URL("../../../../../lib/db/migrations/20261002_booking_date_provenance.sql", import.meta.url), "utf8"));
      const evidence = [
        {field:"reservation_start" as const,kind:"verified_reservation" as const,value:"2027-03-13",semantics:"inclusive_date" as const,revision:1,sourceRef:{type:"google_calendar",id:"event",revision:"etag1"}},
        {field:"reservation_end" as const,kind:"verified_reservation" as const,value:"2027-03-15",semantics:"exclusive_date" as const,revision:1,sourceRef:{type:"google_calendar",id:"event",revision:"etag1"}},
      ];
      for(const e of evidence) await db.query("insert into booking_date_evidence(booking_id,field,kind,value,semantics,revision,source_type,source_id,source_revision,actor) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'owner')",[bookingId,e.field,e.kind,e.value,e.semantics,e.revision,e.sourceRef.type,e.sourceRef.id,e.sourceRef.revision]);
      const input = {bookingId,rawPublic:{start:null,end:null},rawReservation:{start:"2027-03-13T07:00:00Z",end:"2027-03-15T06:00:00Z"},evidence};
      const result = await db.query<{value:any}>("select booking_resolved_dates($1,null,null,$2::timestamptz,$3::timestamptz) as value",[bookingId,input.rawReservation.start,input.rawReservation.end]);
      expect(result.rows[0].value.reservationWindow).toEqual({start:"2027-03-13T07:00:00.000Z",end:"2027-03-15T06:00:00.000Z"});
      expect(result.rows[0].value.reservationWindow).toEqual(resolveBookingDates(input).reservationWindow);
      await db.query("insert into booking_date_evidence(booking_id,field,kind,value,semantics,revision,source_type,source_id,source_revision,actor) values ($1,'reservation_start','verified_reservation','2027-03-14','inclusive_date',1,'manual','other','1','owner')",[bookingId]);
      const conflict = await db.query<{value:any}>("select booking_resolved_dates($1,null,null,$2::timestamptz,$3::timestamptz) as value",[bookingId,input.rawReservation.start,input.rawReservation.end]);
      expect(conflict.rows[0].value.reservationWindow).toBeNull();
    } finally { await db.close(); }
  }, 30_000);
});


it("matches SQL for early supported years without throwing on padded ISO date components",async()=>{
 const db=new PGlite();try{
  await db.exec("create table bookings(id uuid primary key,starts_at timestamptz,ends_at timestamptz)");
  await db.exec(await readFile(new URL("../../../../../lib/db/migrations/20261002_booking_date_provenance.sql",import.meta.url),"utf8"));
  const result=await db.query<{value:string|null}>("SELECT booking_date_iso(booking_date_value('0001-01-01','inclusive_date','public_start')) value");
  let value:string|null;try{value=dateEndpointInstant("0001-01-01","inclusive_date","public_start");}catch{value="conversion threw";}
  expect(value).toEqual(result.rows[0].value);
 }finally{await db.close();}
},30000);
