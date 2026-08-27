import type { Pool } from "pg";
import { pool as defaultPool } from "@workspace/db";

const advisoryLockSql =
  "SELECT pg_advisory_lock(hashtext('adventure-zone:profile-touch-schema'))";
const advisoryUnlockSql =
  "SELECT pg_advisory_unlock(hashtext('adventure-zone:profile-touch-schema'))";

/**
 * Keep organizations.updated_at as the cheap source of truth for the Profiles
 * directory "Recently updated" sort. Local CRM work touches the owning profile,
 * while imported ACT history does not make an old profile look newly worked.
 */
export async function ensureProfileTouchSchema(
  pool: Pool = defaultPool,
): Promise<void> {
  const client = await pool.connect();
  let locked = false;

  try {
    await client.query(advisoryLockSql);
    locked = true;

    await client.query(`
      CREATE INDEX IF NOT EXISTS organizations_updated_at_idx
        ON organizations (updated_at DESC, name ASC, id ASC);

      CREATE OR REPLACE FUNCTION touch_profile(profile_id uuid, touched_at timestamptz DEFAULT clock_timestamp())
      RETURNS void
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF profile_id IS NOT NULL THEN
          UPDATE organizations
          SET updated_at = GREATEST(updated_at, touched_at)
          WHERE id = profile_id;
        END IF;
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

      DROP TRIGGER IF EXISTS activities_touch_profile ON activities;
      CREATE TRIGGER activities_touch_profile
        AFTER INSERT OR UPDATE OR DELETE ON activities
        FOR EACH ROW EXECUTE FUNCTION touch_profile_from_activity();

      DROP TRIGGER IF EXISTS activity_associations_touch_profile ON activity_associations;
      CREATE TRIGGER activity_associations_touch_profile
        AFTER INSERT OR UPDATE OR DELETE ON activity_associations
        FOR EACH ROW EXECUTE FUNCTION touch_profile_from_activity_association();

      WITH local_activity_profiles AS (
        SELECT profile_id, max(changed_at) AS changed_at
        FROM (
          SELECT a.organization_id AS profile_id, a.updated_at AS changed_at
          FROM activities a
          WHERE a.source_record_id IS NULL AND a.organization_id IS NOT NULL

          UNION ALL

          SELECT b.organization_id AS profile_id, a.updated_at AS changed_at
          FROM activities a
          JOIN bookings b ON b.id = a.booking_id
          WHERE a.source_record_id IS NULL AND b.organization_id IS NOT NULL

          UNION ALL

          SELECT oc.organization_id AS profile_id, a.updated_at AS changed_at
          FROM activities a
          JOIN organization_contacts oc ON oc.contact_id = a.contact_id AND oc.active = true
          WHERE a.source_record_id IS NULL

          UNION ALL

          SELECT aa.organization_id AS profile_id, a.updated_at AS changed_at
          FROM activity_associations aa
          JOIN activities a ON a.id = aa.activity_id
          WHERE a.source_record_id IS NULL AND aa.organization_id IS NOT NULL

          UNION ALL

          SELECT b.organization_id AS profile_id, a.updated_at AS changed_at
          FROM activity_associations aa
          JOIN activities a ON a.id = aa.activity_id
          JOIN bookings b ON b.id = aa.booking_id
          WHERE a.source_record_id IS NULL AND aa.booking_id IS NOT NULL

          UNION ALL

          SELECT oc.organization_id AS profile_id, a.updated_at AS changed_at
          FROM activity_associations aa
          JOIN activities a ON a.id = aa.activity_id
          JOIN organization_contacts oc ON oc.contact_id = aa.contact_id AND oc.active = true
          WHERE a.source_record_id IS NULL AND aa.contact_id IS NOT NULL
        ) local_changes
        WHERE profile_id IS NOT NULL
        GROUP BY profile_id
      )
      UPDATE organizations o
      SET updated_at = GREATEST(o.updated_at, p.changed_at)
      FROM local_activity_profiles p
      WHERE o.id = p.profile_id
        AND p.changed_at > o.updated_at;
    `);
  } finally {
    if (locked) {
      await client.query(advisoryUnlockSql).catch(() => undefined);
    }
    client.release();
  }
}
