import { sql } from "drizzle-orm";

import type { db as database } from "@/db/client";

type DrizzleDatabase = typeof database;
type Transaction = Parameters<Parameters<DrizzleDatabase["transaction"]>[0]>[0];

/**
 * Re-parent references that the legacy duplicate-merge transaction does not yet
 * own directly. The operation is idempotent so a failed merge can be retried
 * safely without losing ACT history/timeline relationships.
 */
export async function prepareOrganizationMergeReferences(
  database: Pick<DrizzleDatabase, "transaction"> | Transaction,
  primaryId: string,
  duplicateIds: string[],
): Promise<void> {
  if (!duplicateIds.length) return;

  const prepare = async (transaction: Transaction) => {
    for (const duplicateId of duplicateIds) {
      // Keep activity/timeline associations. If the survivor already has the
      // same activity association, leave that row in place and remove only the
      // redundant duplicate row below.
      await transaction.execute(sql`
        UPDATE activity_associations AS duplicate_association
        SET organization_id = ${primaryId}
        WHERE duplicate_association.organization_id = ${duplicateId}
          AND NOT EXISTS (
            SELECT 1
            FROM activity_associations AS surviving_association
            WHERE surviving_association.activity_id = duplicate_association.activity_id
              AND surviving_association.organization_id = ${primaryId}
          )
      `);
      await transaction.execute(sql`
        DELETE FROM activity_associations
        WHERE organization_id = ${duplicateId}
      `);

      // Suggestions keep pointing at the surviving profile instead of blocking
      // deletion through ai_booking_suggestions_organization_id_fkey.
      await transaction.execute(sql`
        UPDATE ai_booking_suggestions
        SET organization_id = ${primaryId}, updated_at = now()
        WHERE organization_id = ${duplicateId}
      `);

      // Event-family membership does not currently have an FK, so preserve the
      // logical relationship explicitly and avoid leaving orphan member IDs.
      await transaction.execute(sql`
        DELETE FROM event_family_members AS duplicate_member
        WHERE duplicate_member.organization_id = ${duplicateId}
          AND EXISTS (
            SELECT 1
            FROM event_family_members AS surviving_member
            WHERE surviving_member.organization_id = ${primaryId}
          )
      `);
      await transaction.execute(sql`
        UPDATE event_family_members
        SET organization_id = ${primaryId}
        WHERE organization_id = ${duplicateId}
      `);

      // A duplicate can also be the manual parent of another organization. Keep
      // those children attached to the survivor, while preventing a self-parent
      // if the chosen survivor itself was attached to the duplicate.
      await transaction.execute(sql`
        UPDATE organizations
        SET parent_organization_id = NULL, updated_at = now()
        WHERE id = ${primaryId}
          AND parent_organization_id = ${duplicateId}
      `);
      await transaction.execute(sql`
        UPDATE organizations
        SET parent_organization_id = ${primaryId}, updated_at = now()
        WHERE parent_organization_id = ${duplicateId}
          AND id <> ${primaryId}
      `);
    }
  };
  if ("rollback" in database) {
    await prepare(database as Transaction);
  } else {
    await database.transaction(prepare);
  }
}
