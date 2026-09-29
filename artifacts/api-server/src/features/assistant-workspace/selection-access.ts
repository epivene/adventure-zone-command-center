import {
  selectionSchema,
  type Actor,
  type Queryable,
  type Selection,
} from "./contracts";

/** Direct UI handoffs select profiles. Related records must be resolved by the existing tools. */
export async function validateSelectionAccess(
  db: Queryable,
  actor: Actor,
  selection: Selection,
): Promise<Selection> {
  const scope = selectionSchema.parse(selection);
  if (actor.role !== "owner" || !actor.id)
    throw new Error("ASSISTANT_ACCESS_DENIED");
  if (scope.bookingId || scope.threadId || scope.draftId || scope.batchId)
    throw new Error("ASSISTANT_SCOPE_REQUIRES_PROFILE_SELECTION");
  if (new Set(scope.organizationIds).size !== scope.organizationIds.length)
    throw new Error("ASSISTANT_SCOPE_INVALID");
  if (scope.organizationIds.length) {
    // Profiles are shared CRM records. The route enforces the configured owner allowlist.
    // Caller holds the transaction through submission so deletion cannot race the snapshot.
    const found = await db.query(
      "SELECT id FROM organizations WHERE id=ANY($1::uuid[]) FOR SHARE",
      [scope.organizationIds],
    );
    if (found.rows.length !== scope.organizationIds.length)
      throw new Error("ASSISTANT_PROFILE_NOT_FOUND");
  }
  return scope;
}
