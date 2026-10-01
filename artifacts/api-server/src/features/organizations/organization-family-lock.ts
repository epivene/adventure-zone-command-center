import { sql } from "drizzle-orm";

import {
  actExternalLinks,
  actMigrationRecords,
  organizations,
} from "@/db/schema";

export const organizationFamilyReviewAdvisoryLockKey = 734_802_341;

type LockTransaction = {
  execute(query: unknown): Promise<unknown>;
};

/**
 * All consolidation, family-review, proposal, and merge flows enter this advisory
 * domain before taking organization row or table locks. Keeping this first
 * prevents lock-order inversion.
 */
export async function lockOrganizationMutationDomain(
  transaction: LockTransaction,
): Promise<void> {
  await transaction.execute(
    sql`select pg_advisory_xact_lock(${organizationFamilyReviewAdvisoryLockKey})`,
  );
}

/**
 * Creates an authoritative family-decision snapshot.
 *
 * ACT importers lock migration rows before organization rows. The family flow
 * therefore takes EXCLUSIVE table locks on the ACT evidence tables first. In
 * PostgreSQL, EXCLUSIVE conflicts with the ROW SHARE lock taken by SELECT FOR
 * UPDATE, so an importer that already owns an ACT row makes this flow wait
 * before it can own the organization table. Conversely, a family flow that
 * wins first blocks new ACT row lockers before they can own ACT rows.
 *
 * The organizations EXCLUSIVE lock then stabilizes the complete organization
 * set against concurrent INSERT/UPDATE/DELETE while ordinary readers remain
 * allowed on all three tables.
 *
 * Lock order is always:
 *   1. family advisory transaction lock
 *   2. ACT migration records, then ACT external links
 *   3. organizations table
 *   4. review/organization row locks in deterministic key order
 */
export async function lockOrganizationFamilyMutationSnapshot(
  transaction: LockTransaction,
): Promise<void> {
  await lockOrganizationMutationDomain(transaction);
  await transaction.execute(
    sql`lock table ${actMigrationRecords}, ${actExternalLinks} in exclusive mode`,
  );
  await transaction.execute(
    sql`lock table ${organizations} in exclusive mode`,
  );
}

// Compatibility name retained for existing callers/tests that only need to
// serialize a synthetic critical section.
export const lockOrganizationFamilyReviewDomain =
  lockOrganizationMutationDomain;
