import { installReviewedDateFixtures } from "../booking-date-repair/date-fixtures";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import { ids } from "./planning-fixtures";
export const planningFixtureSql = `
CREATE TABLE travel_legs(id uuid PRIMARY KEY,name text,archived_at timestamptz,base_address text);
CREATE TABLE bookings(id uuid PRIMARY KEY,name text,status text,travel_leg_id uuid,starts_at timestamptz,ends_at timestamptz,latitude double precision,longitude double precision,updated_at timestamptz DEFAULT now());
CREATE TABLE crew_workers(id uuid PRIMARY KEY,name text,rehire_status text);
CREATE TABLE crew_worker_leg_memberships(worker_id uuid,leg_id uuid);
CREATE TABLE leg_manager_access(leg_id uuid PRIMARY KEY,session_version integer);
INSERT INTO leg_manager_access VALUES('${ids.leg}',1);
CREATE TABLE resources(id uuid PRIMARY KEY,name text,category text,status text,minimum_transfer_minutes integer DEFAULT 0);
CREATE TABLE package_templates(id uuid PRIMARY KEY,name text,code text,normal_capacity integer,temporary_unavailable_quantity integer DEFAULT 0,active boolean DEFAULT true);
CREATE TABLE boss_accounts(id uuid PRIMARY KEY,enabled boolean,session_version integer DEFAULT 1,display_name text DEFAULT 'Fixture Dave');
CREATE TABLE booking_operational_windows(booking_id uuid PRIMARY KEY,starts_at timestamptz,ends_at timestamptz,source text);
CREATE TABLE booking_package_selections(booking_id uuid,package_template_id uuid);
CREATE TABLE booking_resource_assignments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),booking_id uuid,resource_id uuid,attribution_source text DEFAULT 'manual');
CREATE TABLE google_operational_calendar_links(booking_id uuid,last_app_snapshot jsonb);
CREATE TABLE booking_leg_assignments(booking_id uuid,previous_stop_drive_minutes integer,next_stop_drive_minutes integer);
CREATE TABLE trips(id uuid PRIMARY KEY,travel_leg_id uuid,start_date timestamptz,end_date timestamptz,route_confirmed_at timestamptz);
CREATE TABLE trip_stops(id uuid PRIMARY KEY,trip_id uuid,booking_id uuid);
CREATE TABLE trip_resource_assignments(trip_id uuid,resource_id uuid);
CREATE TABLE outreach_holds(id uuid PRIMARY KEY,booking_id uuid,leg_id uuid,starts_on date,ends_on date,resource_ids jsonb,quantities jsonb,state text,expires_at timestamptz);
INSERT INTO travel_legs(id,name) VALUES('${ids.leg}','Angel');
INSERT INTO bookings(id,name,status,travel_leg_id,starts_at,ends_at,latitude,longitude) VALUES('${ids.booking}','Fixture Fair','confirmed','${ids.leg}','2027-07-21T12:00:00Z','2027-07-26T12:00:00Z',40,-111);
INSERT INTO crew_workers VALUES('${ids.worker}','Fixture worker','rehirable');
INSERT INTO crew_worker_leg_memberships VALUES('${ids.worker}','${ids.leg}');
INSERT INTO resources(id,name,category,status) VALUES('${ids.resource}','Fixture pool','Pool','available');
INSERT INTO package_templates(id,name,code,normal_capacity) VALUES('${ids.package}','Pirates','pirates_rebellion',3);
INSERT INTO booking_package_selections VALUES('${ids.booking}','${ids.package}');
INSERT INTO boss_accounts(id,enabled) VALUES('${ids.boss}',true);
`;
export async function planningDatabase(options: {reviewDates?:boolean} = {}) {
  const pg = new PGlite();
  await pg.exec(planningFixtureSql);
  if(options.reviewDates !== false) await installReviewedDateFixtures(pg);
  // PGlite has one connection; this test-only no-op is NOT concurrency evidence.
  await pg.exec(`CREATE FUNCTION pg_advisory_xact_lock(bigint) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;
    CREATE TABLE outreach_candidates(checked_at timestamptz,source_snapshot jsonb);`);
  await pg.exec(
    await readFile(
      new URL(
        "../../../../../lib/db/migrations/20261001_leg_planning.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  return { pg, db: drizzle(pg) };
}
