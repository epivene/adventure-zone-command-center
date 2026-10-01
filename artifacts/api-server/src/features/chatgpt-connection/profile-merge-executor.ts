import { drizzle } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import type { SqlQuery } from "./contracts";
import { ConnectionError } from "./contracts";
import { DrizzleOrganizationRepository } from "../organizations/organization-repository";
import { prepareSelectedProfileSubsetMerge } from "../organizations/profile-subset-merge-guard";
import { prepareOrganizationMergeReferences } from "../organizations/organization-merge-reference-preparation";
import type { OrganizationMergeTransaction } from "../organizations/organization-merge-additional-references";
import { OrganizationConflictError } from "../organizations/organization-conflict";

export async function executeProfileMerge(
  client: SqlQuery,
  primaryId: string,
  duplicateIds: string[],
) {
  // The OperationStore owns BEGIN/COMMIT on this pinned node-postgres client.
  // Supply Drizzle query builders over that same client, never a second pool or transaction.
  const database = drizzle(client as PoolClient);
  const tx = Object.assign(database, {
    rollback(): never {
      throw new Error("Merge rolled back");
    },
  }) as unknown as OrganizationMergeTransaction;
  try {
    await prepareSelectedProfileSubsetMerge(tx, [primaryId, ...duplicateIds]);
    await prepareOrganizationMergeReferences(tx, primaryId, duplicateIds);
    await new DrizzleOrganizationRepository(database as any).mergeOrganizations(
      primaryId,
      duplicateIds,
      tx,
    );
  } catch (error) {
    if (error instanceof OrganizationConflictError)
      throw new ConnectionError("CONNECTION_MERGE_BLOCKED", 409, error.message);
    throw error;
  }
}
