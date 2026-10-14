import { pool as defaultPool } from "@workspace/db";

// Schema repair only. Existing contact consolidation decisions are preserved.
const ensureSchemaSql = `
      CREATE TABLE IF NOT EXISTS contact_consolidations (
        source_contact_id uuid PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
        canonical_contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
        consolidated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT contact_consolidations_distinct_ids
          CHECK (source_contact_id <> canonical_contact_id)
      );

      CREATE INDEX IF NOT EXISTS contact_consolidations_canonical_idx
        ON contact_consolidations (canonical_contact_id);

      ALTER TABLE organizations
        ADD COLUMN IF NOT EXISTS filler boolean DEFAULT false NOT NULL;

      ALTER TABLE organizations
        ADD COLUMN IF NOT EXISTS filler_reason text;

      ALTER TABLE organizations
        ADD COLUMN IF NOT EXISTS filler_changed_at timestamptz;

      ALTER TABLE organizations
        DROP CONSTRAINT IF EXISTS organizations_filler_reason_required;

      ALTER TABLE organizations
        ADD CONSTRAINT organizations_filler_reason_required
        CHECK (NOT filler OR nullif(btrim(filler_reason), '') IS NOT NULL);

      ALTER TABLE organizations
        ADD COLUMN IF NOT EXISTS last_worked_at timestamptz;

      UPDATE organizations
      SET last_worked_at = created_at
      WHERE last_worked_at IS NULL;

      CREATE INDEX IF NOT EXISTS organizations_last_worked_at_idx
        ON organizations (last_worked_at DESC, name ASC, id ASC);

      CREATE OR REPLACE FUNCTION touch_profile(profile_id uuid, touched_at timestamptz DEFAULT clock_timestamp())
      RETURNS void
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF profile_id IS NOT NULL THEN
          UPDATE organizations
          SET last_worked_at = GREATEST(COALESCE(last_worked_at, created_at), touched_at)
          WHERE id = profile_id;
        END IF;
      END;
      $$;

      CREATE OR REPLACE FUNCTION touch_profile_from_organization_edit()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF ROW(
          OLD.name, OLD.place_type, OLD.phone, OLD.address_1, OLD.address_2,
          OLD.city, OLD.region, OLD.postal_code, OLD.website,
          OLD.last_resort, OLD.last_resort_reason,
          OLD.parent_organization_id, OLD.consolidated_into_id
        ) IS DISTINCT FROM ROW(
          NEW.name, NEW.place_type, NEW.phone, NEW.address_1, NEW.address_2,
          NEW.city, NEW.region, NEW.postal_code, NEW.website,
          NEW.last_resort, NEW.last_resort_reason,
          NEW.parent_organization_id, NEW.consolidated_into_id
        ) THEN
          NEW.last_worked_at := GREATEST(
            COALESCE(OLD.last_worked_at, OLD.created_at),
            clock_timestamp()
          );
        END IF;
        RETURN NEW;
      END;
      $$;

      CREATE OR REPLACE FUNCTION touch_profile_from_organization_location()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      DECLARE
        changed_at timestamptz;
      BEGIN
        changed_at := COALESCE(
          CASE WHEN TG_OP = 'DELETE' THEN OLD.updated_at ELSE NEW.updated_at END,
          clock_timestamp()
        );
        IF TG_OP = 'DELETE' THEN
          PERFORM touch_profile(OLD.organization_id, changed_at);
          RETURN OLD;
        END IF;
        PERFORM touch_profile(NEW.organization_id, changed_at);
        IF TG_OP = 'UPDATE' AND OLD.organization_id IS DISTINCT FROM NEW.organization_id THEN
          PERFORM touch_profile(OLD.organization_id, changed_at);
        END IF;
        RETURN NEW;
      END;
      $$;

      CREATE OR REPLACE FUNCTION touch_profile_from_activity()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      DECLARE
        row_activity activities%ROWTYPE;
        changed_at timestamptz;
      BEGIN
        row_activity := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
        IF row_activity.source_record_id IS NOT NULL THEN
          RETURN COALESCE(NEW, OLD);
        END IF;

        changed_at := COALESCE(row_activity.updated_at, row_activity.created_at, clock_timestamp());
        PERFORM touch_profile(row_activity.organization_id, changed_at);

        IF row_activity.booking_id IS NOT NULL THEN
          PERFORM touch_profile((SELECT organization_id FROM bookings WHERE id = row_activity.booking_id), changed_at);
        END IF;

        IF row_activity.contact_id IS NOT NULL THEN
          PERFORM touch_profile(oc.organization_id, changed_at)
          FROM organization_contacts oc
          WHERE oc.contact_id = row_activity.contact_id AND oc.active = true;
        END IF;

        PERFORM touch_profile(aa.organization_id, changed_at)
        FROM activity_associations aa
        WHERE aa.activity_id = row_activity.id AND aa.organization_id IS NOT NULL;

        PERFORM touch_profile(b.organization_id, changed_at)
        FROM activity_associations aa
        JOIN bookings b ON b.id = aa.booking_id
        WHERE aa.activity_id = row_activity.id AND aa.booking_id IS NOT NULL;

        PERFORM touch_profile(oc.organization_id, changed_at)
        FROM activity_associations aa
        JOIN organization_contacts oc ON oc.contact_id = aa.contact_id AND oc.active = true
        WHERE aa.activity_id = row_activity.id AND aa.contact_id IS NOT NULL;

        RETURN COALESCE(NEW, OLD);
      END;
      $$;

      CREATE OR REPLACE FUNCTION touch_profile_from_activity_association()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      DECLARE
        row_association activity_associations%ROWTYPE;
        linked_activity activities%ROWTYPE;
        changed_at timestamptz;
      BEGIN
        row_association := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
        SELECT * INTO linked_activity FROM activities WHERE id = row_association.activity_id;
        IF linked_activity.source_record_id IS NOT NULL THEN
          RETURN COALESCE(NEW, OLD);
        END IF;

        changed_at := COALESCE(linked_activity.updated_at, linked_activity.created_at, clock_timestamp());
        PERFORM touch_profile(row_association.organization_id, changed_at);
        IF row_association.booking_id IS NOT NULL THEN
          PERFORM touch_profile((SELECT organization_id FROM bookings WHERE id = row_association.booking_id), changed_at);
        END IF;
        IF row_association.contact_id IS NOT NULL THEN
          PERFORM touch_profile(oc.organization_id, changed_at)
          FROM organization_contacts oc
          WHERE oc.contact_id = row_association.contact_id AND oc.active = true;
        END IF;
        RETURN COALESCE(NEW, OLD);
      END;
      $$;

      CREATE OR REPLACE FUNCTION touch_profile_from_contact()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      DECLARE
        row_contact contacts%ROWTYPE;
        changed_at timestamptz;
      BEGIN
        row_contact := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
        changed_at := COALESCE(row_contact.updated_at, row_contact.created_at, clock_timestamp());
        PERFORM touch_profile(row_contact.organization_id, changed_at);
        PERFORM touch_profile(oc.organization_id, changed_at)
        FROM organization_contacts oc
        WHERE oc.contact_id = row_contact.id AND oc.active = true;
        IF row_contact.organization_location_id IS NOT NULL THEN
          PERFORM touch_profile((SELECT organization_id FROM organization_locations WHERE id = row_contact.organization_location_id), changed_at);
        END IF;
        RETURN COALESCE(NEW, OLD);
      END;
      $$;

      CREATE OR REPLACE FUNCTION touch_profile_from_organization_contact()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          PERFORM touch_profile(OLD.organization_id);
          RETURN OLD;
        END IF;
        PERFORM touch_profile(NEW.organization_id);
        IF TG_OP = 'UPDATE' AND OLD.organization_id IS DISTINCT FROM NEW.organization_id THEN
          PERFORM touch_profile(OLD.organization_id);
        END IF;
        RETURN NEW;
      END;
      $$;

      CREATE OR REPLACE FUNCTION touch_profile_from_booking()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      DECLARE
        changed_at timestamptz;
      BEGIN
        changed_at := COALESCE(
          CASE WHEN TG_OP = 'DELETE' THEN OLD.updated_at ELSE NEW.updated_at END,
          clock_timestamp()
        );
        IF TG_OP = 'DELETE' THEN
          PERFORM touch_profile(OLD.organization_id, changed_at);
          RETURN OLD;
        END IF;
        PERFORM touch_profile(NEW.organization_id, changed_at);
        IF TG_OP = 'UPDATE' AND OLD.organization_id IS DISTINCT FROM NEW.organization_id THEN
          PERFORM touch_profile(OLD.organization_id, changed_at);
        END IF;
        RETURN NEW;
      END;
      $$;

      CREATE OR REPLACE FUNCTION touch_profile_from_follow_up()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      DECLARE
        row_follow_up follow_ups%ROWTYPE;
        changed_at timestamptz;
      BEGIN
        row_follow_up := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
        changed_at := COALESCE(row_follow_up.updated_at, row_follow_up.created_at, clock_timestamp());
        PERFORM touch_profile(row_follow_up.organization_id, changed_at);
        IF row_follow_up.booking_id IS NOT NULL THEN
          PERFORM touch_profile((SELECT organization_id FROM bookings WHERE id = row_follow_up.booking_id), changed_at);
        END IF;
        IF row_follow_up.contact_id IS NOT NULL THEN
          PERFORM touch_profile(oc.organization_id, changed_at)
          FROM organization_contacts oc
          WHERE oc.contact_id = row_follow_up.contact_id AND oc.active = true;
        END IF;
        RETURN COALESCE(NEW, OLD);
      END;
      $$;

      DROP TRIGGER IF EXISTS organizations_touch_profile_work ON organizations;
      CREATE TRIGGER organizations_touch_profile_work
        BEFORE UPDATE ON organizations
        FOR EACH ROW EXECUTE FUNCTION touch_profile_from_organization_edit();

      DROP TRIGGER IF EXISTS organization_locations_touch_profile_work ON organization_locations;
      CREATE TRIGGER organization_locations_touch_profile_work
        AFTER INSERT OR UPDATE OR DELETE ON organization_locations
        FOR EACH ROW EXECUTE FUNCTION touch_profile_from_organization_location();

      DROP TRIGGER IF EXISTS activities_touch_profile ON activities;
      CREATE TRIGGER activities_touch_profile
        AFTER INSERT OR UPDATE OR DELETE ON activities
        FOR EACH ROW EXECUTE FUNCTION touch_profile_from_activity();

      DROP TRIGGER IF EXISTS activity_associations_touch_profile ON activity_associations;
      CREATE TRIGGER activity_associations_touch_profile
        AFTER INSERT OR UPDATE OR DELETE ON activity_associations
        FOR EACH ROW EXECUTE FUNCTION touch_profile_from_activity_association();

      DROP TRIGGER IF EXISTS contacts_touch_profile_work ON contacts;
      CREATE TRIGGER contacts_touch_profile_work
        AFTER INSERT OR UPDATE OR DELETE ON contacts
        FOR EACH ROW EXECUTE FUNCTION touch_profile_from_contact();

      DROP TRIGGER IF EXISTS organization_contacts_touch_profile_work ON organization_contacts;
      CREATE TRIGGER organization_contacts_touch_profile_work
        AFTER INSERT OR UPDATE OR DELETE ON organization_contacts
        FOR EACH ROW EXECUTE FUNCTION touch_profile_from_organization_contact();

      DROP TRIGGER IF EXISTS bookings_touch_profile_work ON bookings;
      CREATE TRIGGER bookings_touch_profile_work
        AFTER INSERT OR UPDATE OR DELETE ON bookings
        FOR EACH ROW EXECUTE FUNCTION touch_profile_from_booking();

      DROP TRIGGER IF EXISTS follow_ups_touch_profile_work ON follow_ups;
      CREATE TRIGGER follow_ups_touch_profile_work
        AFTER INSERT OR UPDATE OR DELETE ON follow_ups
        FOR EACH ROW EXECUTE FUNCTION touch_profile_from_follow_up();

      WITH local_activity_profiles AS (
        SELECT profile_id, max(changed_at) AS changed_at
        FROM (
          SELECT a.organization_id AS profile_id, a.updated_at AS changed_at
          FROM activities a
          WHERE a.source_record_id IS NULL AND a.organization_id IS NOT NULL

          UNION ALL
          SELECT b.organization_id, a.updated_at
          FROM activities a
          JOIN bookings b ON b.id = a.booking_id
          WHERE a.source_record_id IS NULL AND b.organization_id IS NOT NULL

          UNION ALL
          SELECT oc.organization_id, a.updated_at
          FROM activities a
          JOIN organization_contacts oc ON oc.contact_id = a.contact_id AND oc.active = true
          WHERE a.source_record_id IS NULL

          UNION ALL
          SELECT aa.organization_id, a.updated_at
          FROM activity_associations aa
          JOIN activities a ON a.id = aa.activity_id
          WHERE a.source_record_id IS NULL AND aa.organization_id IS NOT NULL

          UNION ALL
          SELECT b.organization_id, a.updated_at
          FROM activity_associations aa
          JOIN activities a ON a.id = aa.activity_id
          JOIN bookings b ON b.id = aa.booking_id
          WHERE a.source_record_id IS NULL AND aa.booking_id IS NOT NULL

          UNION ALL
          SELECT oc.organization_id, a.updated_at
          FROM activity_associations aa
          JOIN activities a ON a.id = aa.activity_id
          JOIN organization_contacts oc ON oc.contact_id = aa.contact_id AND oc.active = true
          WHERE a.source_record_id IS NULL AND aa.contact_id IS NOT NULL

          UNION ALL
          SELECT f.organization_id, f.updated_at
          FROM follow_ups f
          WHERE f.organization_id IS NOT NULL

          UNION ALL
          SELECT b.organization_id, f.updated_at
          FROM follow_ups f
          JOIN bookings b ON b.id = f.booking_id
          WHERE f.booking_id IS NOT NULL AND b.organization_id IS NOT NULL

          UNION ALL
          SELECT oc.organization_id, f.updated_at
          FROM follow_ups f
          JOIN organization_contacts oc ON oc.contact_id = f.contact_id AND oc.active = true
          WHERE f.contact_id IS NOT NULL
        ) local_changes
        WHERE profile_id IS NOT NULL
        GROUP BY profile_id
      )
      UPDATE organizations o
      SET last_worked_at = GREATEST(COALESCE(o.last_worked_at, o.created_at), p.changed_at)
      FROM local_activity_profiles p
      WHERE o.id = p.profile_id
        AND p.changed_at > COALESCE(o.last_worked_at, o.created_at);
`;

export const profileTouchReadySql = `SELECT
 NOT EXISTS(SELECT 1 FROM (VALUES ('filler'),('filler_reason'),('filler_changed_at'),('last_worked_at')) e(name)
 WHERE NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='organizations' AND column_name=e.name))
 AND NOT EXISTS(SELECT 1 FROM (VALUES ('source_contact_id'),('canonical_contact_id'),('consolidated_at')) e(name)
 WHERE NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='contact_consolidations' AND column_name=e.name))
 AND NOT EXISTS(SELECT 1 FROM (VALUES ('organizations_last_worked_at_idx'),('contact_consolidations_canonical_idx')) e(name)
 WHERE NOT EXISTS(SELECT 1 FROM pg_index WHERE indexrelid=to_regclass(current_schema()||'.'||e.name) AND indisvalid))
 AND EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass(current_schema()||'.organizations') AND conname='organizations_filler_reason_required' AND convalidated)
 AND to_regprocedure(current_schema()||'.touch_profile(uuid,timestamp with time zone)') IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM (VALUES
('organizations','organizations_touch_profile_work','touch_profile_from_organization_edit',19),
('organization_locations','organization_locations_touch_profile_work','touch_profile_from_organization_location',29),
('activities','activities_touch_profile','touch_profile_from_activity',29),
('activity_associations','activity_associations_touch_profile','touch_profile_from_activity_association',29),
('contacts','contacts_touch_profile_work','touch_profile_from_contact',29),
('organization_contacts','organization_contacts_touch_profile_work','touch_profile_from_organization_contact',29),
('bookings','bookings_touch_profile_work','touch_profile_from_booking',29),
('follow_ups','follow_ups_touch_profile_work','touch_profile_from_follow_up',29)
 ) e(table_name,trigger_name,function_name,event_type)
 WHERE NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=to_regclass(current_schema()||'.'||e.table_name)
 AND t.tgname=e.trigger_name AND t.tgfoid=to_regprocedure(current_schema()||'.'||e.function_name||'()')
 AND t.tgtype=e.event_type AND t.tgenabled IN ('O','A') AND NOT t.tgisinternal
 AND t.tgnargs=0 AND t.tgqual IS NULL AND cardinality(t.tgattr::smallint[])=0)) AS ready`;

async function isProfileTouchSchemaReady(client: Client): Promise<boolean> {
  return (await client.query(profileTouchReadySql)).rows[0]?.ready === true;
}
const advisoryTryLockSql =
  "SELECT pg_try_advisory_xact_lock(hashtext('adventure-zone:profile-touch-schema')) AS locked";

type Client = {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
  release(destroy?: boolean): void;
};
type Pool = { connect(): Promise<Client> };

export async function ensureProfileTouchSchema(
  pool: Pool = defaultPool as unknown as Pool,
  options?: { lockWaitMs?: number },
): Promise<void> {
  const client = await pool.connect();
  let inTransaction = false;
  let destroy = false;
  try {
    await client.query("BEGIN");
    inTransaction = true;
    // Server-side limits cancel blocked work before the pool's 60s read timeout.
    // SET LOCAL never leaks a timeout setting into unrelated pooled requests.
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '20s'");
    if (await isProfileTouchSchemaReady(client)) {
      await client.query("COMMIT");
      inTransaction = false;
      return;
    }
    const deadline =
      Date.now() + Math.max(0, Math.min(options?.lockWaitMs ?? 10_000, 10_000));
    for (;;) {
      const result = await client.query(advisoryTryLockSql);
      if (result.rows[0]?.locked === true) break;
      if (Date.now() >= deadline)
        throw new Error("PROFILE_TOUCH_SCHEMA_LOCK_BUSY");
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(250, Math.max(1, deadline - Date.now()))),
      );
    }
    // A competing deploy may have finished while we waited for the lock.
    if (!(await isProfileTouchSchemaReady(client))) {
      await client.query(ensureSchemaSql);
    }
    if (!(await isProfileTouchSchemaReady(client))) {
      throw new Error("PROFILE_TOUCH_SCHEMA_INCOMPLETE");
    }
    await client.query("COMMIT");
    inTransaction = false;
    return;
  } catch (error) {
    // A client-side timeout can leave work running on this connection. Never
    // return a failed migration connection or its locks to the request pool.
    destroy = true;
    const connectionUnusable =
      error instanceof Error &&
      /query read timeout|connection terminated|connection closed/i.test(
        error.message,
      );
    if (inTransaction && !connectionUnusable)
      await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release(destroy);
  }
}
