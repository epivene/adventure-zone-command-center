import {
  changeFingerprint,
  type TaskChangeProof,
} from "./profile-task-evidence";
import type { ActionIntent, Grant } from "./contracts";
import {
  taskAuthoritySchema,
  type Task,
  type TaskItem,
  type TaskScope,
  type TaskAuthority,
} from "./profile-task-contracts";
const fields = new Set([
  "phone",
  "website",
  "address1",
  "address2",
  "city",
  "region",
  "postalCode",
]);
export function compileTaskAuthority(request: {
  actorId: string;
  sourceMessageId: string;
  scope: TaskScope;
  explicitActions: string[];
}): TaskAuthority {
  if (
    !request.actorId ||
    request.explicitActions.some(
      (k) => !["add_profile_note", "update_profile"].includes(k),
    ) ||
    request.scope.requestedFields.some((k) => !fields.has(k))
  )
    throw new Error("ASSISTANT_TASK_AUTHORITY_INVALID");
  return taskAuthoritySchema.parse({
    sourceMessageId: request.sourceMessageId,
    profileIds: request.scope.profileIds,
    actionKinds: [...new Set(request.explicitActions)],
    allowedFields: request.scope.requestedFields,
  });
}
export function grantTaskAction(
  task: Task,
  item: TaskItem,
  intent: ActionIntent,
  currentRevision: string | null,
  currentFields?: Record<string, unknown>,
  proof?: TaskChangeProof | null,
): Grant | null {
  if (
    !proof ||
    proof.profileId !== item.profileId ||
    proof.fingerprint !== changeFingerprint(intent) ||
    !proof.evidenceIds.length
  )
    return null;
  if (
    task.state !== "running" ||
    task.actorId !== intent.actorId ||
    task.conversationId !== intent.conversationId ||
    task.sourceMessageId !== intent.sourceMessageId ||
    item.taskId !== task.id ||
    item.eventYear !== task.scope.eventYear ||
    item.profileId !== intent.targetId ||
    !task.scope.profileIds.includes(intent.targetId) ||
    !task.authority.profileIds.includes(intent.targetId) ||
    !task.authority.actionKinds.includes(intent.kind) ||
    intent.connectionId !== null
  )
    return null;
  if (intent.kind === "update_profile") {
    const values = intent.arguments as Record<string, unknown>;
    if (
      !values ||
      typeof values !== "object" ||
      !currentFields ||
      !currentRevision ||
      intent.expectedRevision !== currentRevision ||
      !Object.keys(values).length ||
      Object.keys(values).some(
        (k) =>
          !fields.has(k) ||
          !task.authority.allowedFields.includes(k) ||
          (currentFields[k] !== null && currentFields[k] !== ""),
      )
    )
      return null;
  } else if (intent.kind !== "add_profile_note") return null;
  return {
    actorId: task.actorId,
    sourceMessageId: task.sourceMessageId,
    actionKind: intent.kind,
    targetIds: [item.profileId],
    revision: intent.expectedRevision,
    connectionId: null,
  };
}
