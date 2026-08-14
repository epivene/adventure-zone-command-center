import { sql } from "drizzle-orm";

import {
  actExternalLinks,
  actMigrationRecords,
  organizations,
} from "@/db/schema";

const organizationFamilyReviewAdvisoryLockKey = 734_802_341;

type LockTransaction = {
  execute(query: unknown): Promise<unknown>;
};

/**
 * All hierarchy, family-review, proposal, and merge flows enter this advisory
 * domain before taking organization row or table locks. Keeping this first
 * prevents hierarchy-vs-family lock inversion.
 */
export async function lockOrganizationHierarchyMutationDomain(
  transaction: LockTransaction,
): Promise<void> {
  await transaction.execute(
    sql`select pg_advisory_xact_lock(${organizationFamilyReviewAdvisoryLockKey})`,
  );
}

/**
 * Creates an authoritative family-decision snapshot.
 *
 * Organization families are discovered from the complete organization set, so
 * an EXCLUSIVE table lock is required to make concurrent INSERT/UPDATE/DELETE
 * wait until the rare review/merge transaction commits. ACT evidence is read
 * from the migration/link tables; SHARE locks keep those relationships stable
 * for the same transaction while still allowing ordinary readers.
 *
 * Lock order is always:
 *   1. family advisory transaction lock
 *   2. organizations table
 *   3. ACT migration records, then ACT external links
 *   4. review/organization row locks in deterministic key order
 */
export async function lockOrganizationFamilyMutationSnapshot(
  transaction: LockTransaction,
): Promise<void> {
  await lockOrganizationHierarchyMutationDomain(transaction);
  await transaction.execute(
    sql`lock table ${organizations} in exclusive mode`,
  );
  await transaction.execute(
    sql`lock table ${actMigrationRecords}, ${actExternalLinks} in share mode`,
  );
}

// Compatibility name retained for existing callers/tests that only need to
// serialize a synthetic critical section.
export const lockOrganizationFamilyReviewDomain =
  lockOrganizationHierarchyMutationDomain;
