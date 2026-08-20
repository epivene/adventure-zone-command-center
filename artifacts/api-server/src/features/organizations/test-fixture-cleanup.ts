import { sql } from "drizzle-orm";

import type { db as database } from "@/db/client";

type DrizzleDatabase = typeof database;

export const LEAKED_CONSOLIDATION_FIXTURE_CLEANUP_SQL = `
DO $$
DECLARE
  parent_record record;
  target_ids uuid[];
BEGIN
  FOR parent_record IN
    SELECT parent.id
    FROM organizations parent
    WHERE parent.name = 'Double-Run Fairs'
      AND parent.consolidated_into_id IS NULL
      AND EXISTS (
        SELECT 1
        FROM organizations child_a
        WHERE child_a.consolidated_into_id = parent.id
          AND child_a.name = 'Repeat Fair A'
          AND child_a.city = 'Rockford'
          AND child_a.region = 'IL'
      )
      AND EXISTS (
        SELECT 1
        FROM organizations child_b
        WHERE child_b.consolidated_into_id = parent.id
          AND child_b.name = 'Repeat Fair B'
          AND child_b.city = 'Aurora'
          AND child_b.region = 'IL'
      )
  LOOP
    SELECT array_agg(id)
    INTO target_ids
    FROM organizations
    WHERE id = parent_record.id
       OR (
         consolidated_into_id = parent_record.id
         AND (
           (name = 'Repeat Fair A' AND city = 'Rockford' AND region = 'IL')
           OR (name = 'Repeat Fair B' AND city = 'Aurora' AND region = 'IL')
         )
       );

    IF target_ids IS NULL OR array_length(target_ids, 1) <> 3 THEN
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM organization_contacts WHERE organization_id = ANY(target_ids)
    ) OR EXISTS (
      SELECT 1 FROM bookings WHERE organization_id = ANY(target_ids)
    ) OR EXISTS (
      SELECT 1 FROM activities WHERE organization_id = ANY(target_ids)
    ) OR EXISTS (
      SELECT 1 FROM follow_ups WHERE organization_id = ANY(target_ids)
    ) THEN
      CONTINUE;
    END IF;

    DELETE FROM organization_locations
    WHERE organization_id = ANY(target_ids)
       OR consolidation_source_org_id = ANY(target_ids);

    DELETE FROM organizations
    WHERE consolidated_into_id = parent_record.id
      AND (
        (name = 'Repeat Fair A' AND city = 'Rockford' AND region = 'IL')
        OR (name = 'Repeat Fair B' AND city = 'Aurora' AND region = 'IL')
      );

    DELETE FROM organizations
    WHERE id = parent_record.id
      AND name = 'Double-Run Fairs';
  END LOOP;
END $$;
`;

let cleanupPromise: Promise<void> | null = null;

export function cleanupLeakedConsolidationTestFixtures(
  database: DrizzleDatabase,
): Promise<void> {
  cleanupPromise ??= database
    .execute(sql.raw(LEAKED_CONSOLIDATION_FIXTURE_CLEANUP_SQL))
    .then(() => undefined)
    .catch((error) => {
      cleanupPromise = null;
      throw error;
    });
  return cleanupPromise;
}
