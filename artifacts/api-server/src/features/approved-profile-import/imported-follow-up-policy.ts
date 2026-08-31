export type ImportedFollowUpAction =
  | { action: "reuse_exact"; followUpId: string }
  | { action: "preserve_open"; followUpId: string }
  | { action: "replace_and_create" }
  | { action: "create" };

export function decideImportedFollowUpAction(input: {
  preserveExisting: boolean;
  exactOpenId: string | null;
  openIds: string[];
}): ImportedFollowUpAction {
  if (input.exactOpenId) {
    return { action: "reuse_exact", followUpId: input.exactOpenId };
  }
  if (input.preserveExisting && input.openIds.length > 0) {
    return { action: "preserve_open", followUpId: input.openIds[0]! };
  }
  if (input.openIds.length > 0) {
    return { action: "replace_and_create" };
  }
  return { action: "create" };
}
