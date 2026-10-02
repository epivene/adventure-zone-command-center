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
      await sql.exec(`CREATE TABLE "${c.name}" (${c.columns.map(col => `"${col.name}" ${'enumValues' in col && col.enumValues ? 'text' : col.getSQLType()}`).join(',')})`);
    }
    const id = '10000000-0000-4000-8000-000000000001';
    await sql.query(`INSERT INTO bookings(id,name,status,probability,starts_at,ends_at) VALUES($1,'New year fair','confirmed','definite','2027-01-01T06:30:00Z','2027-01-01T06:45:00Z')`, [id]);
    await sql.query(`INSERT INTO booking_operational_windows(booking_id,starts_at,ends_at) VALUES($1,'2026-12-30T18:00:00Z','2027-01-02T18:00:00Z')`, [id]);
    const repository = new DrizzleTravelLegRepository(drizzle(sql) as unknown as ConstructorParameters<typeof DrizzleTravelLegRepository>[0]);
    const rows = await repository.listMapEvents();
    expect(rows[0].seasonYear).toBe(2026);
    expect(rows[0].startsAt?.toISOString()).toBe('2027-01-01T06:30:00.000Z');
    expect(rows[0].reservedEndsAt?.toISOString()).toBe('2027-01-02T18:00:00.000Z');
    expect(filterMapEvents(rows, { statuses: [], travelLegIds: [], regions: [], dateFrom: '2027-01-01', dateTo: '2027-12-31' })).toHaveLength(1);
    const importedId = '10000000-0000-4000-8000-000000000002';
    await sql.query(`INSERT INTO bookings(id,name,status,probability,starts_at,ends_at) VALUES($1,'Imported January','confirmed','definite','2027-01-01T00:00:00Z','2027-01-02T00:00:00Z')`, [importedId]);
    await sql.query(`INSERT INTO google_operational_calendar_links(booking_id,last_app_snapshot) VALUES($1,'{"imported":true}')`, [importedId]);
    const imported = (await repository.listMapEvents()).find(row => row.id === importedId)!;
    expect(imported.dateOnly).toBe(true);
    expect(imported.seasonYear).toBe(2027);
    expect(filterMapEvents([imported], { statuses: [], travelLegIds: [], regions: [], dateFrom: '2027-01-01', dateTo: '2027-12-31' })).toHaveLength(1);
    expect(filterMapEvents([imported], { statuses: [], travelLegIds: [], regions: [], dateFrom: '2026-01-01', dateTo: '2026-12-31' })).toHaveLength(0);
  } finally { await sql.close(); }
});
