import type { Queryable } from "./contracts";
import {
  taskScopeSchema,
  taskAuthoritySchema,
  type Task,
  type TaskScope,
  type TaskAuthority,
  type TaskCommand,
  type TaskItem,
  type TaskCounts,
} from "./profile-task-contracts";
export function countTaskItems(items: { state: string }[]): TaskCounts {
  const result = {
    total: items.length,
    completed: 0,
    needsReview: 0,
    failed: 0,
    remaining: 0,
  };
  for (const item of items) {
    if (item.state === "completed") result.completed++;
    else if (item.state === "needs_review") result.needsReview++;
    else if (item.state === "failed") result.failed++;
    else result.remaining++;
  }
  return result;
}
export async function taskTransaction<T>(
  db: Queryable,
  fn: (tx: Queryable) => Promise<T>,
): Promise<T> {
  const source = db as Queryable & {
    transaction?: <R>(fn: (tx: Queryable) => Promise<R>) => Promise<R>;
    connect?: () => Promise<Queryable & { release(): void }>;
  };
  if (source.transaction) return source.transaction(fn);
  if (!source.connect) throw new Error("ASSISTANT_TRANSACTION_REQUIRED");
  const client = await source.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
function mapItem(r: any): TaskItem {
  return {
    id: r.id,
    taskId: r.task_id,
    profileId: r.profile_id,
    profileNameSnapshot: r.profile_name_snapshot,
    eventYear: r.event_year,
    state: r.state,
    attempts: r.attempts,
    reason: r.reason,
    evidenceIds: r.evidence_ids,
    receiptIds: r.receipt_ids,
    actionIds: r.action_ids,
  };
}
export class ProfileTaskStore {
  constructor(readonly db: Queryable) {}
  async get(actorId: string, id: string): Promise<Task | null> {
    const r = (
      await this.db.query(
        "SELECT * FROM assistant_profile_tasks WHERE actor_id=$1 AND id=$2",
        [actorId, id],
      )
    ).rows[0];
    if (!r) return null;
    const items = (
      await this.db.query(
        "SELECT * FROM assistant_profile_task_items WHERE task_id=$1 ORDER BY ordinal",
        [id],
      )
    ).rows.map(mapItem);
    return {
      id: r.id,
      actorId: r.actor_id,
      conversationId: r.conversation_id,
      sourceMessageId: r.source_message_id,
      scope: r.scope,
      authority: r.authority,
      state: r.state,
      version: r.version,
      pauseReason: r.pause_reason,
      counts: countTaskItems(items),
      items,
    };
  }
  async list(actorId: string, conversationId: string): Promise<Task[]> {
    const rows = (
      await this.db.query(
        "SELECT id FROM assistant_profile_tasks WHERE actor_id=$1 AND conversation_id=$2 ORDER BY created_at DESC",
        [actorId, conversationId],
      )
    ).rows;
    return (await Promise.all(rows.map((r) => this.get(actorId, r.id)))).filter(
      (r): r is Task => !!r,
    );
  }
  async create(
    actorId: string,
    conversationId: string,
    requestKey: string,
    rawScope: TaskScope,
    rawAuthority: TaskAuthority,
  ): Promise<Task> {
    const scope = taskScopeSchema.parse(rawScope),
      authority = taskAuthoritySchema.parse(rawAuthority);
    if (!requestKey || requestKey.length > 200)
      throw new Error("ASSISTANT_TASK_INVALID");
    if (authority.profileIds.some((id) => !scope.profileIds.includes(id)))
      throw new Error("ASSISTANT_ACCESS_DENIED");
    const id = await taskTransaction(this.db, async (tx) => {
      const c = (
        await tx.query(
          "SELECT lifecycle FROM assistant_workspace_conversations WHERE id=$1 AND actor_id=$2 FOR UPDATE",
          [conversationId, actorId],
        )
      ).rows[0];
      if (!c) throw new Error("ASSISTANT_ACCESS_DENIED");
      const previous = (
        await tx.query(
          "SELECT id,scope,authority FROM assistant_profile_tasks WHERE actor_id=$1 AND conversation_id=$2 AND request_key=$3",
          [actorId, conversationId, requestKey],
        )
      ).rows[0];
      if (previous) {
        if (
          JSON.stringify(previous.scope) !==
            JSON.stringify(JSON.parse(JSON.stringify(scope))) ||
          JSON.stringify(previous.authority) !== JSON.stringify(authority)
        ) {
          // jsonb key order is canonical, compare through PostgreSQL.
          const same = (
            await tx.query(
              "SELECT scope=$2::jsonb AND authority=$3::jsonb AS same FROM assistant_profile_tasks WHERE id=$1",
              [previous.id, JSON.stringify(scope), JSON.stringify(authority)],
            )
          ).rows[0];
          if (!same.same) throw new Error("ASSISTANT_TASK_CONFLICT");
        }
        return previous.id;
      }
      if (c.lifecycle !== "active")
        throw new Error("ASSISTANT_CONVERSATION_INACTIVE");
      const message = (
        await tx.query(
          "SELECT id FROM assistant_workspace_messages WHERE id=$1 AND actor_id=$2 AND conversation_id=$3 AND role='user'",
          [authority.sourceMessageId, actorId, conversationId],
        )
      ).rows[0];
      if (!message) throw new Error("ASSISTANT_ACCESS_DENIED");
      const row = (
        await tx.query(
          "INSERT INTO assistant_profile_tasks(actor_id,conversation_id,source_message_id,request_key,scope,authority) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb) RETURNING id",
          [
            actorId,
            conversationId,
            authority.sourceMessageId,
            requestKey,
            JSON.stringify(scope),
            JSON.stringify(authority),
          ],
        )
      ).rows[0];
      await tx.query(
        "INSERT INTO assistant_profile_task_items(task_id,profile_id,event_year,ordinal) SELECT $1,value::uuid,$3,ordinality FROM jsonb_array_elements_text($2::jsonb) WITH ORDINALITY",
        [row.id, JSON.stringify(scope.profileIds), scope.eventYear],
      );
      const hasProfiles = (
        await tx.query(
          "SELECT to_regclass('organizations') IS NOT NULL AS exists",
        )
      ).rows[0].exists;
      if (hasProfiles) {
        const profiles = (
          await tx.query(
            "SELECT id,name FROM organizations WHERE id=ANY($1::uuid[]) AND consolidated_into_id IS NULL FOR SHARE",
            [scope.profileIds],
          )
        ).rows;
        if (profiles.length !== scope.profileIds.length)
          throw Error("ASSISTANT_PROFILE_NOT_FOUND");
        for (const profile of profiles)
          await tx.query(
            "UPDATE assistant_profile_task_items SET profile_name_snapshot=$3 WHERE task_id=$1 AND profile_id=$2",
            [row.id, profile.id, profile.name],
          );
      }
      return row.id;
    });
    return (await this.get(actorId, id))!;
  }
  async command(
    actorId: string,
    id: string,
    expectedVersion: number,
    command: TaskCommand,
    itemIds: string[] = [],
    requestKey?: string,
    completionMode?: "manual" | "sourced_notes" | "profile_fields",
  ): Promise<Task> {
    await taskTransaction(this.db, async (tx) => {
      const row = (
        await tx.query(
          "SELECT t.*, c.lifecycle FROM assistant_profile_tasks t JOIN assistant_workspace_conversations c ON c.id=t.conversation_id AND c.actor_id=t.actor_id WHERE t.id=$1 AND t.actor_id=$2 FOR UPDATE OF c,t",
          [id, actorId],
        )
      ).rows[0];
      if (!row) throw new Error("ASSISTANT_ACCESS_DENIED");
      const payload = JSON.stringify({
        expectedVersion,
        command,
        itemIds,
        completionMode,
      });
      if (requestKey) {
        const prior = (
          await tx.query(
            "SELECT payload=$3::jsonb AS same FROM assistant_profile_task_commands WHERE task_id=$1 AND request_key=$2",
            [id, requestKey, payload],
          )
        ).rows[0];
        if (prior) {
          if (!prior.same) throw new Error("ASSISTANT_TASK_CONFLICT");
          return;
        }
      }
      if (row.version !== expectedVersion)
        throw new Error("ASSISTANT_TASK_CONFLICT");
      if (
        row.state === "cancelled" ||
        (row.state === "completed" && command !== "retry")
      )
        throw new Error("ASSISTANT_TASK_TERMINAL");
      if (row.lifecycle !== "active" && command !== "cancel")
        throw new Error("ASSISTANT_CONVERSATION_INACTIVE");
      if (!["pause", "resume", "cancel", "skip", "retry"].includes(command))
        throw new Error("ASSISTANT_TASK_INVALID");
      if (completionMode) {
        if (
          command !== "resume" ||
          row.state !== "proposed" ||
          !["manual", "sourced_notes", "profile_fields"].includes(
            completionMode,
          )
        )
          throw Error("ASSISTANT_TASK_CONFLICT");
        if (
          completionMode === "profile_fields" &&
          (row.scope.eventYear !== null || !row.scope.requestedFields.length)
        )
          throw Error("ASSISTANT_TASK_INVALID");
        await tx.query(
          "UPDATE assistant_profile_tasks SET scope=jsonb_set(scope,'{completionMode}',to_jsonb($2::text)) WHERE id=$1",
          [id, completionMode],
        );
      }
      if (command === "skip" || command === "retry") {
        if (
          !itemIds.length ||
          new Set(itemIds).size !== itemIds.length ||
          itemIds.length > 4
        )
          throw new Error("ASSISTANT_TASK_INVALID");
        const items = (
          await tx.query(
            "SELECT id,state FROM assistant_profile_task_items WHERE task_id=$1 AND id=ANY($2::uuid[]) FOR UPDATE",
            [id, itemIds],
          )
        ).rows;
        if (
          items.length !== itemIds.length ||
          items.some((i) =>
            ["researching", "uncertain", "completed"].includes(i.state),
          )
        )
          throw new Error("ASSISTANT_TASK_CONFLICT");
        await tx.query(
          "UPDATE assistant_profile_task_items SET state=$3,reason=$4,attempts=CASE WHEN $3='pending' THEN 0 ELSE attempts END WHERE task_id=$1 AND id=ANY($2::uuid[])",
          [
            id,
            itemIds,
            command === "skip" ? "needs_review" : "pending",
            command === "skip" ? "user_skipped" : null,
          ],
        );
      }
      if (requestKey)
        await tx.query(
          "INSERT INTO assistant_profile_task_commands(task_id,request_key,payload) VALUES($1,$2,$3::jsonb)",
          [id, requestKey, payload],
        );
      const state =
        command === "retry"
          ? "running"
          : command === "pause"
            ? "paused"
            : command === "resume"
              ? "running"
              : command === "cancel"
                ? "cancelled"
                : row.state;
      await tx.query(
        "UPDATE assistant_profile_tasks SET state=$3,version=version+1,pause_reason=$4,updated_at=now() WHERE id=$1 AND actor_id=$2",
        [id, actorId, state, command === "pause" ? "user_paused" : null],
      );
    });
    return (await this.get(actorId, id))!;
  }
}
