import { readFileSync } from "node:fs";
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { expect, it } from 'vitest';
import * as schema from '@/db/schema';
import { DrizzleTravelLegRepository } from './travel-leg-repository';
import { filterMapEvents } from './map-data';
it('projects saved reserved windows without replacing public dates', async () => {
  const sql = new PGlite();
  try {
    for (const table of [schema.bookings, schema.travelLegs, schema.bookingLegAssignments, schema.bookingOperationalWindows, schema.googleOperationalCalendarLinks]) {
      const c = getTableConfig(table);
      await sql.exec(`CREATE TABLE "${c.name}" (${c.columns.map(col => `"${col.name}" ${'enumValues' in col && col.enumValues ? 'text' : col.getSQLType()}${col.name === 'id' ? ' PRIMARY KEY DEFAULT gen_random_uuid()' : ''}`).join(',')})`);
    }
    await sql.exec(readFileSync(new URL("../../../../../lib/db/migrations/20261002_booking_date_provenance.sql",import.meta.url),"utf8"));
    const seed = async (bookingId: string, field: string, value: string, semantics = "instant") => sql.query(`insert into booking_date_evidence(booking_id,field,kind,value,semantics,revision,source_type,source_id,source_revision,actor) values($1,$2,$3,$4,$5,1,'saved_note','fixture','1','owner')`, [bookingId,field,field.startsWith("public")?"verified_event":"verified_reservation",value,semantics]);
    const id = '10000000-0000-4000-8000-000000000001';
    await sql.query(`INSERT INTO bookings(id,name,status,probability,starts_at,ends_at) VALUES($1,'New year fair','confirmed','definite','2027-01-01T06:30:00Z','2027-01-01T06:45:00Z')`, [id]);
    await sql.query(`INSERT INTO booking_operational_windows(booking_id,starts_at,ends_at) VALUES($1,'2026-12-30T18:00:00Z','2027-01-02T18:00:00Z')`, [id]);
    for(const [field,value] of [["public_start","2027-01-01T06:30:00Z"],["public_end","2027-01-01T06:45:00Z"],["reservation_start","2026-12-30T18:00:00Z"],["reservation_end","2027-01-02T18:00:00Z"]]) await seed(id,field,value);
    const repository = new DrizzleTravelLegRepository(drizzle(sql) as unknown as ConstructorParameters<typeof DrizzleTravelLegRepository>[0]);
    const rows = await repository.listMapEvents();
    expect(rows[0].seasonYear).toBe(2026);
    expect(rows[0].startsAt?.toISOString()).toBe('2027-01-01T06:30:00.000Z');
    expect(rows[0].reservedEndsAt?.toISOString()).toBe('2027-01-02T18:00:00.000Z');
    expect(filterMapEvents(rows, { statuses: [], travelLegIds: [], regions: [], dateFrom: '2027-01-01', dateTo: '2027-12-31' })).toHaveLength(1);
    const importedId = '10000000-0000-4000-8000-000000000002';
    await sql.query(`INSERT INTO bookings(id,name,status,probability,starts_at,ends_at) VALUES($1,'Imported January','confirmed','definite','2027-01-01T00:00:00Z','2027-01-02T00:00:00Z')`, [importedId]);
    await sql.query(`INSERT INTO google_operational_calendar_links(booking_id,last_app_snapshot) VALUES($1,'{"imported":true}')`, [importedId]);
    await seed(importedId,"public_start","2027-01-01","inclusive_date");
    await seed(importedId,"public_end","2027-01-02","inclusive_date");
    const sentinelId = '10000000-0000-4000-8000-000000000003';
    await sql.query(`INSERT INTO bookings(id,name,status,probability,starts_at,ends_at) VALUES($1,'Unverified sales','new_lead','tentative','2026-01-01','9999-12-31')`,[sentinelId]);
    const unresolved = (await repository.listMapEvents()).find(row=>row.id===sentinelId)!;
    expect(unresolved.startsAt).toBeNull();
    expect(filterMapEvents([unresolved],{statuses:[],travelLegIds:[],regions:[],dateFrom:'2027-01-01',dateTo:'2027-12-31'})).toHaveLength(0);
    const imported = (await repository.listMapEvents()).find(row => row.id === importedId)!;
    expect(imported.dateOnly).toBe(false);
    expect(imported.seasonYear).toBe(2027);
    expect(filterMapEvents([imported], { statuses: [], travelLegIds: [], regions: [], dateFrom: '2027-01-01', dateTo: '2027-12-31' })).toHaveLength(1);
    expect(filterMapEvents([imported], { statuses: [], travelLegIds: [], regions: [], dateFrom: '2026-01-01', dateTo: '2026-12-31' })).toHaveLength(0);
  } finally { await sql.close(); }
},30_000);
