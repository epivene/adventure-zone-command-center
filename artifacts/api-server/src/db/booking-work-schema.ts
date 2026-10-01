import type { SqlQuery } from "../features/chatgpt-connection/contracts";
export async function ensureBookingWorkSchema(db: SqlQuery) {
  await db.query(`CREATE TABLE IF NOT EXISTS booking_work_activities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), profile_id uuid NOT NULL REFERENCES organizations(id),
 event_year integer NOT NULL CHECK(event_year BETWEEN 2000 AND 2200), booking_id uuid REFERENCES bookings(id),
 queue text NOT NULL CHECK(queue IN ('new_leads','replies','followups','paperwork','routes')),
 title text NOT NULL, next_action text NOT NULL, assigned_to jsonb,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','researching','draft_ready','waiting_desiree','waiting_customer','blocked','completed','cancelled')),
 due_at timestamptz, progress jsonb, links jsonb NOT NULL DEFAULT '[]', revision integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()), updated_at timestamptz NOT NULL DEFAULT now())`);
  await db.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS booking_work_active_profile_year ON booking_work_activities(profile_id,event_year) WHERE status NOT IN ('completed','cancelled')`,
  );
  await db.query(
    `CREATE INDEX IF NOT EXISTS booking_work_page ON booking_work_activities(created_at,id)`,
  );
}
