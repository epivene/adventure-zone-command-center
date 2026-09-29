import { createHash } from "node:crypto";
import { canonicalJson } from "./action-store";
import type { Queryable, RunContext, ActionIntent } from "./contracts";
export function taskChangeId(change: {
  taskId: string;
  targetId: string;
  kind: string;
  expectedRevision: string | null;
  arguments: unknown;
}) {
  const hex = createHash("sha256").update(canonicalJson(change)).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export async function guardTaskMutation(
  db: Queryable,
  context: RunContext,
  intent: ActionIntent,
  enabled: boolean,
) {
  if (context.taskId) {
    const uncertain = (
      await db.query(
        `SELECT a.id FROM assistant_profile_task_items i JOIN assistant_workspace_actions a ON i.action_ids @> jsonb_build_array(a.id::text) LEFT JOIN assistant_workspace_mutation_results m ON m.action_id=a.id AND m.actor_id=a.actor_id WHERE i.task_id=$1 AND i.profile_id=$2 AND a.actor_id=$3 AND a.id<>$4 AND a.status IN ('provider_started','uncertain') AND m.action_id IS NULL LIMIT 1`,
        [context.taskId, intent.targetId, context.actor.id, intent.id],
      )
    ).rows[0];
    if (uncertain) throw Error("ASSISTANT_ACTION_RECONCILIATION_REQUIRED");
  }
  const linked = (
    await db.query(
      `SELECT t.id,t.state,t.version,i.state AS item_state,c.lifecycle FROM assistant_profile_tasks t JOIN assistant_profile_task_items i ON i.task_id=t.id JOIN assistant_workspace_conversations c ON c.id=t.conversation_id AND c.actor_id=t.actor_id WHERE t.actor_id=$1 AND i.action_ids @> $2::jsonb`,
      [context.actor.id, JSON.stringify([intent.id])],
    )
  ).rows[0];
  if (!linked) return;
  if (context.taskId !== linked.id)
    throw Error("ASSISTANT_TASK_REVIEW_REQUIRED");
  if (
    !enabled ||
    linked.state === "cancelled" ||
    linked.state === "completed" ||
    linked.lifecycle !== "active"
  )
    throw Error("ASSISTANT_TASK_PAUSED");
  if (
    context.taskReview &&
    (context.taskVersion !== linked.version ||
      linked.item_state !== "awaiting_review")
  )
    throw Error("ASSISTANT_TASK_CONFLICT");
  if (!context.taskReview && linked.state !== "running")
    throw Error("ASSISTANT_TASK_PAUSED");
}
