import { installReviewedDateFixtures } from "../booking-date-repair/date-fixtures";
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { expect, it, vi } from 'vitest';
vi.mock('@workspace/db', async () => ({ ...(await import('@workspace/db/schema')), pool: {}, db: {} }));
import * as schema from '@/db/schema';
import { createBookingLegOperationsService } from './booking-leg-operations-providers';
it('real provider retains equipment conflict without exposing another leg customer to managers', async () => {
 const db = new PGlite();
 try {
  for (const table of [schema.organizations,schema.bookings,schema.travelLegs,schema.bookingOperationalWindows,schema.bookingLegAssignments,schema.eventFamilyMembers,schema.packageTemplates,schema.bookingPackageSelections,schema.googleOperationalCalendarLinks,schema.googleWorkspaceConnections,schema.resources,schema.bookingResourceAssignments,schema.bookingSpecialRequests,schema.resourceConflictOverrides,schema.trips,schema.tripResourceAssignments]) {
   const c = getTableConfig(table);
   await db.exec(`CREATE TABLE "${c.name}" (${c.columns.map(col => `"${col.name}" ${'enumValues' in col && col.enumValues ? 'text' : col.getSQLType()}${col.name === "id" ? " PRIMARY KEY DEFAULT gen_random_uuid()" : ""}`).join(',')})`);
  }
  await installReviewedDateFixtures(db);
  const own='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',leg='20000000-0000-4000-8000-000000000001',otherLeg='20000000-0000-4000-8000-000000000002',resource='30000000-0000-4000-8000-000000000001';
  await db.query(`INSERT INTO travel_legs(id,name,color) VALUES($1,'Angel','#123456'),($2,'Hulk','#654321')`,[leg,otherLeg]);
  await db.query(`INSERT INTO bookings(id,name,status,travel_leg_id,starts_at,ends_at,latitude,longitude) VALUES($1,'Own fair','confirmed',$3,'2027-07-01T18:00:00Z','2027-07-03T18:00:00Z',40,-111),($2,'Private other-leg customer','confirmed',$4,'2027-07-01T18:00:00Z','2027-07-03T18:00:00Z',41,-112)`,[own,other,leg,otherLeg]);
  await db.query(`INSERT INTO resources(id,code,name,category,status,counts_as_attraction,movable,setup_minutes,teardown_minutes,minimum_transfer_minutes) VALUES($1,'pool','Pool','attraction','active',true,true,0,0,0)`,[resource]);
  await db.query(`INSERT INTO booking_resource_assignments(id,booking_id,resource_id) VALUES('40000000-0000-4000-8000-000000000001',$1,$3),('40000000-0000-4000-8000-000000000002',$2,$3)`,[own,other,resource]);
  const service=createBookingLegOperationsService(db,drizzle(db) as unknown as Parameters<typeof createBookingLegOperationsService>[1]);
  const owner=await service.get(own,{kind:'owner'});
  expect(owner?.resources.state).toBe('loaded');
  expect(JSON.stringify(owner?.resources)).toContain('Private other-leg customer');
  const manager=await service.get(own,{kind:'manager',legId:leg});
  expect(manager?.resources).toMatchObject({state:'loaded',data:{warnings:expect.arrayContaining([expect.objectContaining({severity:'blocking'})])}});
  expect(JSON.stringify(manager)).not.toContain('Private other-leg customer');
  expect(JSON.stringify(manager?.resources)).not.toContain(other);
 } finally {await db.close();}
}, 30000);
