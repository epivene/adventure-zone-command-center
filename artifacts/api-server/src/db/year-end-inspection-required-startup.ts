import { pool as defaultPool } from "@workspace/db";

const advisoryTryLockSql =
  "SELECT pg_try_advisory_lock(hashtext('adventure-zone:year-end-inspection-schema')) AS locked";
const advisoryUnlockSql =
  "SELECT pg_advisory_unlock(hashtext('adventure-zone:year-end-inspection-schema'))";

export const YEAR_END_INSPECTION_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS equipment_pieces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL, name text NOT NULL,
  piece_type text NOT NULL DEFAULT 'inflatable_component',
  current_leg_id uuid REFERENCES travel_legs(id) ON DELETE RESTRICT,
  storage_location text, identity_notes text,
  lifecycle_status text NOT NULL DEFAULT 'active' CHECK (lifecycle_status IN ('active','stored_spare','needs_repair','replace','retired')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), archived_at timestamptz,
  CHECK (nullif(trim(code), '') IS NOT NULL), CHECK (nullif(trim(name), '') IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS equipment_pieces_active_code_unique ON equipment_pieces(lower(code)) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS equipment_pieces_leg_status_idx ON equipment_pieces(current_leg_id, lifecycle_status) WHERE archived_at IS NULL;
CREATE TABLE IF NOT EXISTS equipment_piece_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), piece_id uuid NOT NULL REFERENCES equipment_pieces(id) ON DELETE RESTRICT,
  resource_id uuid NOT NULL REFERENCES resources(id) ON DELETE RESTRICT, assigned_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz, actor_id text NOT NULL, reason text
);
CREATE UNIQUE INDEX IF NOT EXISTS equipment_piece_assignments_active_piece_unique ON equipment_piece_assignments(piece_id) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS equipment_piece_assignments_resource_idx ON equipment_piece_assignments(resource_id, assigned_at DESC);
CREATE TABLE IF NOT EXISTS year_end_leg_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_mutation_id uuid NOT NULL UNIQUE,
  leg_id uuid NOT NULL REFERENCES travel_legs(id) ON DELETE RESTRICT,
  inspection_year integer NOT NULL CHECK (inspection_year BETWEEN 2000 AND 2200),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_progress','completed')),
  copied_from_inspection_id uuid REFERENCES year_end_leg_inspections(id) ON DELETE RESTRICT,
  manager_identity_snapshot text, overall_notes text, admin_follow_up_note text,
  started_at timestamptz, completed_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(), archived_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS year_end_leg_inspections_active_leg_year_unique ON year_end_leg_inspections(leg_id, inspection_year) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS year_end_leg_inspections_leg_updated_idx ON year_end_leg_inspections(leg_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS year_end_inspection_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_mutation_id uuid NOT NULL UNIQUE,
  inspection_id uuid NOT NULL REFERENCES year_end_leg_inspections(id) ON DELETE RESTRICT,
  piece_id uuid NOT NULL REFERENCES equipment_pieces(id) ON DELETE RESTRICT,
  piece_code_snapshot text NOT NULL, piece_name_snapshot text NOT NULL,
  resource_id_snapshot uuid REFERENCES resources(id) ON DELETE SET NULL, resource_name_snapshot text,
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  entry_state text NOT NULL DEFAULT 'not_started' CHECK (entry_state IN ('not_started','inspected','not_present')),
  condition text CHECK (condition IS NULL OR condition IN ('good','needs_cleaning','minor_repair','major_repair','replace','retired')),
  inspection_notes text, repair_needed boolean NOT NULL DEFAULT false, repair_notes text,
  retain_for_future_use boolean NOT NULL DEFAULT true, inspected_at timestamptz,
  inspector_identity_snapshot text, updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (inspection_id, piece_id)
);
CREATE INDEX IF NOT EXISTS year_end_inspection_entries_inspection_order_idx ON year_end_inspection_entries(inspection_id, sort_order);
CREATE TABLE IF NOT EXISTS year_end_inspection_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_mutation_id uuid NOT NULL UNIQUE,
  entry_id uuid NOT NULL REFERENCES year_end_inspection_entries(id) ON DELETE RESTRICT,
  leg_id uuid NOT NULL REFERENCES travel_legs(id) ON DELETE RESTRICT, object_key text,
  upload_status text NOT NULL DEFAULT 'image_pending' CHECK (upload_status IN ('image_pending','image_uploaded','image_failed')),
  mime_type text NOT NULL, description text,
  annotations jsonb NOT NULL DEFAULT '{"version":1,"ellipses":[]}'::jsonb,
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  uploaded_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS year_end_inspection_photos_entry_order_idx ON year_end_inspection_photos(entry_id, sort_order);
CREATE TABLE IF NOT EXISTS year_end_inspection_maintenance_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL UNIQUE REFERENCES year_end_inspection_entries(id) ON DELETE RESTRICT,
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','resolved')),
  follow_up_notes text, resolution_notes text, created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL, resolved_at timestamptz, resolved_by text
);
CREATE INDEX IF NOT EXISTS year_end_inspection_maintenance_state_idx ON year_end_inspection_maintenance_items(state, created_at DESC);
CREATE TABLE IF NOT EXISTS year_end_inspection_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id uuid REFERENCES year_end_leg_inspections(id) ON DELETE RESTRICT,
  piece_id uuid REFERENCES equipment_pieces(id) ON DELETE RESTRICT,
  action text NOT NULL, actor_id text NOT NULL, payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (inspection_id IS NOT NULL OR piece_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS year_end_inspection_audit_inspection_idx ON year_end_inspection_audit_events(inspection_id, created_at DESC);
CREATE INDEX IF NOT EXISTS year_end_inspection_audit_piece_idx ON year_end_inspection_audit_events(piece_id, created_at DESC);
`;

type StartupClient = {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
  release(): void;
};
type StartupPool = { connect(): Promise<StartupClient> };

export async function ensureYearEndInspectionSchemaBeforeListen(options?: { pool?: StartupPool }): Promise<boolean> {
  const pool = options?.pool ?? (defaultPool as unknown as StartupPool);
  const client = await pool.connect();
  let locked = false;
  try {
    const result = await client.query(advisoryTryLockSql);
    locked = result.rows[0]?.locked === true;
    if (!locked) throw new Error("YEAR_END_INSPECTION_SCHEMA_LOCK_BUSY");
    await client.query(YEAR_END_INSPECTION_SCHEMA_SQL);
    return true;
  } finally {
    if (locked) await client.query(advisoryUnlockSql).catch(() => undefined);
    client.release();
  }
}
