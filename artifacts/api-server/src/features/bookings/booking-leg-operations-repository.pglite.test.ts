import { installReviewedDateFixtures } from "../booking-date-repair/date-fixtures";
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { randomUUID } from 'node:crypto';
import * as schema from '@/db/schema';
import { BookingLegOperationsRepository } from './booking-leg-operations-repository';

let db: PGlite, repository: BookingLegOperationsRepository;
const profile = randomUUID(), otherProfile = randomUUID(), family = randomUUID(), angel = randomUUID(), angelo = randomUUID(), target = randomUUID(), historical = randomUUID(), sibling = randomUUID();
beforeEach(async () => {
  db = new PGlite();
  for (const table of [schema.organizations, schema.bookings, schema.travelLegs, schema.bookingOperationalWindows, schema.bookingLegAssignments, schema.eventFamilyMembers, schema.packageTemplates, schema.bookingPackageSelections, schema.googleOperationalCalendarLinks]) {
    const c = getTableConfig(table);
    await db.exec(`CREATE TABLE "${c.name}" (${c.columns.map(col => `"${col.name}" ${'enumValues' in col && col.enumValues ? 'text' : col.getSQLType()}${col.name === "id" ? " PRIMARY KEY DEFAULT gen_random_uuid()" : ""}`).join(',')})`);
  }
  await installReviewedDateFixtures(db);
  await db.query(`INSERT INTO organizations(id,name) VALUES($1,'Fair'),($2,'Family fair')`, [profile, otherProfile]);
  await db.query(`INSERT INTO travel_legs(id,name,archived_at) VALUES($1,'Angel',null),($2,'Angelo','2026-01-01')`, [angel, angelo]);
  await db.query(`INSERT INTO bookings(id,organization_id,name,status,travel_leg_id,starts_at,ends_at) VALUES($1,$2,'Fair 2027','confirmed',$3,'2027-07-04T16:00:00Z','2027-07-05T02:00:00Z'),($4,$2,'Fair 2026','completed',$5,'2026-07-04T16:00:00Z','2026-07-05T02:00:00Z'),($6,$7,'Family Fair','completed',$3,'2026-07-01T16:00:00Z','2026-07-01T20:00:00Z')`, [target, profile, angel, historical, angelo, sibling, otherProfile]);
  repository = new BookingLegOperationsRepository(db);
},30_000);
afterEach(async () => db.close());

it('loads same-profile history without guessing a shared organizer or changing assignments', async () => {
  const evidence = await repository.loadHistory(target, { kind: 'owner' });
  expect(evidence.map(x => x.bookingId)).toEqual([historical]);
  expect(evidence[0].leg).toMatchObject({ id: angelo, name: 'Angelo', archived: true });
  await db.query(`insert into booking_date_evidence(booking_id,field,kind,value,semantics,revision,source_type,source_id,source_revision,actor) values($1,'public_start','verified_event','2027-01-01','inclusive_date',3,'google_calendar','fixture-event','etag','owner'),($1,'public_end','verified_event','2027-01-02','inclusive_date',3,'google_calendar','fixture-event','etag','owner')`,[target]);
 const base = await repository.loadBase(target, { kind: 'owner' });
  expect(base?.booking.travelLegId).toBe(angel);
  expect(base?.booking.status).toBe('confirmed');
  expect((await db.query('SELECT count(*)::int AS n FROM booking_leg_assignments')).rows).toEqual([{ n: 0 }]);
});
it('includes explicit event-family evidence and merges linked package mirrors by booking', async () => {
  await db.query('INSERT INTO event_family_members(organization_id,family_id) VALUES($1,$3),($2,$3)', [profile, otherProfile, family]);
  const packageA = randomUUID(), packageB = randomUUID();
  await db.query(`INSERT INTO package_templates(id,name) VALUES($1,'Adventure Zone'),($2,'Pirates')`, [packageA, packageB]);
  await db.query(`INSERT INTO booking_package_selections(booking_id,package_template_id) VALUES($1,$2),($1,$3)`, [historical, packageA, packageB]);
  const evidence = await repository.loadHistory(target, { kind: 'owner' });
  expect(evidence).toHaveLength(2);
  expect(evidence.find(x => x.bookingId === historical)?.packageNames).toEqual(['Adventure Zone', 'Pirates']);
  expect(evidence.find(x => x.bookingId === sibling)?.relation).toBe('event_family');
});
it('rejects another leg before loading its history', async () => {
  await expect(repository.loadBase(target, { kind: 'manager', legId: angelo })).rejects.toMatchObject({ status: 403 });
  expect(await repository.loadHistory(target, { kind: 'manager', legId: angel })).toEqual([]);
});
it('derives business-year and leaves undated bookings unknown', async () => {
  await db.query(`UPDATE bookings SET starts_at='2027-01-01T03:00:00Z' WHERE id=$1`, [target]);
  expect((await repository.loadBase(target, { kind: 'owner' }))?.booking.seasonYear).toBe(2026);
  await db.query('UPDATE bookings SET starts_at=null,ends_at=null WHERE id=$1', [target]);
  const options = await repository.listProfileBookings(profile, { kind: 'owner' });
  expect(options.find(x => x.id === target)?.seasonYear).toBeNull();
});

it('retains imported all-day January public dates and exclusive reserved end', async () => {
 await db.query(`UPDATE bookings SET starts_at='2027-01-01T00:00:00Z',ends_at='2027-01-02T00:00:00Z' WHERE id=$1`, [target]);
 await db.query(`INSERT INTO google_operational_calendar_links(booking_id,last_app_snapshot) VALUES($1,'{"imported":true}')`, [target]);
 await db.query(`INSERT INTO booking_operational_windows(booking_id,starts_at,ends_at,source) VALUES($1,'2026-12-31T00:00:00Z','2027-01-03T00:00:00Z','google_calendar')`, [target]);
 const base = await repository.loadBase(target, { kind: 'owner' });
 expect(base?.booking.seasonYear).toBe(2027);
 expect(base?.windows).toMatchObject({ publicStartsAt: '2027-01-01T07:00:00.000Z', reservedStartsAt: '2026-12-31T07:00:00.000Z', reservedEndsAt: '2027-01-03T07:00:00.000Z', reservedEndExclusive: true });
 expect((await repository.listProfileBookings(profile, { kind: 'owner' })).find(b => b.id === target)?.seasonYear).toBe(2027);
});

it("keeps unsupported dates in owner review without a public window",async()=>{
 await db.query("UPDATE bookings SET ends_at='9999-12-31' WHERE id=$1",[target]);
 const base=await repository.loadBase(target,{kind:"owner"});
 expect(base?.windows.publicStartsAt).toBeNull();
 expect((base?.windows as any).rawPublicStartsAt).toBe("2027-07-04T16:00:00.000Z");
 expect((base?.windows as any).evidenceState).toBe("needs_review");
});
