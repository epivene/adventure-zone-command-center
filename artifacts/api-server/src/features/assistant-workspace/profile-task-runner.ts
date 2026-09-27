import type { Queryable, RunContext } from "./contracts";
import { emptySelection } from "./contracts";
import { ProfileTaskStore, taskTransaction } from "./profile-task-store";
import { RunStore } from "./run-store";
/** Task claim and child enqueue share one transaction. Child leases/checkpoints are owned by RunStore. */
export class ProfileTaskRunner {
  constructor(
    private db: Queryable,
    private store: ProfileTaskStore,
    private model: string,
    private allowedActorIds = ["owner"],
  ) {}
  async check(context: RunContext) {
    if (!context.taskId) return;
    const row = (
      await this.db.query(
        `SELECT t.state,c.lifecycle FROM assistant_profile_tasks t JOIN assistant_workspace_conversations c ON c.id=t.conversation_id AND c.actor_id=t.actor_id JOIN assistant_profile_task_runs b ON b.task_id=t.id WHERE t.id=$1 AND t.actor_id=$2 AND b.run_id=$3 AND NOT b.settled`,
        [context.taskId, context.actor.id, context.runId],
      )
    ).rows[0];
    if (
      !row ||
      row.state !== "running" ||
      row.lifecycle !== "active" ||
      !this.allowedActorIds.includes(context.actor.id)
    )
      throw Error("ASSISTANT_TASK_PAUSED");
  }
  async dispatchNextTaskBatch(workerId: string): Promise<boolean> {
    await this.reconcileFinished();
    return taskTransaction(this.db, async (tx) => {
      // Always lock conversation before task, matching lifecycle and command locks.
      const c = (
        await tx.query(
          `SELECT c.id FROM assistant_workspace_conversations c WHERE c.lifecycle='active' AND EXISTS(SELECT 1 FROM assistant_profile_tasks t WHERE t.conversation_id=c.id AND t.state='running' AND t.actor_id=ANY($1::text[]) AND NOT EXISTS(SELECT 1 FROM assistant_profile_task_runs b WHERE b.task_id=t.id AND NOT b.settled)) AND NOT EXISTS(SELECT 1 FROM assistant_workspace_runs r WHERE r.conversation_id=c.id AND r.status IN ('queued','running')) ORDER BY c.created_at FOR UPDATE OF c SKIP LOCKED LIMIT 1`,
          [this.allowedActorIds],
        )
      ).rows[0];
      if (!c) return false;
      const row = (
        await tx.query(
          `SELECT * FROM assistant_profile_tasks WHERE conversation_id=$1 AND state='running' AND actor_id=ANY($2::text[]) AND NOT EXISTS(SELECT 1 FROM assistant_profile_task_runs b WHERE b.task_id=assistant_profile_tasks.id AND NOT b.settled) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`,
          [c.id, this.allowedActorIds],
        )
      ).rows[0];
      if (!row) return false;
      const items = (
        await tx.query(
          `SELECT * FROM assistant_profile_task_items WHERE task_id=$1 AND state='pending' ORDER BY ordinal LIMIT 4 FOR UPDATE`,
          [row.id],
        )
      ).rows;
      if (!items.length) {
        await this.finishState(tx, row.id);
        return false;
      }
      const batch = Number(
        (
          await tx.query(
            "SELECT COALESCE(MAX(batch_number),0)+1 AS n FROM assistant_profile_task_runs WHERE task_id=$1",
            [row.id],
          )
        ).rows[0].n,
      );
      const original = (
        await tx.query(
          `SELECT checkpoint->'input'->>'model' AS model FROM assistant_workspace_runs WHERE source_message_id=$1 AND NOT EXISTS(SELECT 1 FROM assistant_profile_task_runs b WHERE b.run_id=assistant_workspace_runs.id) ORDER BY created_at LIMIT 1`,
          [row.source_message_id],
        )
      ).rows[0];
      const run = await new RunStore(tx).enqueue({
        actor: { id: row.actor_id, role: "owner", connectionId: null },
        conversationId: row.conversation_id,
        sourceMessageId: row.source_message_id,
        requestKey: `task:${row.id}:${batch}`,
        selection: {
          ...emptySelection(),
          organizationIds: items.map((i) => i.profile_id),
          eventYear: row.scope.eventYear,
        },
        grants: [],
        model: original?.model ?? this.model,
        taskId: row.id,
        itemIds: items.map((i) => i.id),
      });
      await tx.query(
        "INSERT INTO assistant_profile_task_runs(task_id,run_id,batch_number,item_ids) VALUES($1,$2,$3,$4::jsonb)",
        [row.id, run.id, batch, JSON.stringify(items.map((i) => i.id))],
      );
      await tx.query(
        "UPDATE assistant_profile_task_items SET state='researching',attempts=attempts+1 WHERE id=ANY($1::uuid[])",
        [items.map((i) => i.id)],
      );
      await tx.query(
        "UPDATE assistant_profile_tasks SET worker_id=$2,lease_token=lease_token+1,version=version+1,updated_at=now() WHERE id=$1",
        [row.id, workerId],
      );
      return true;
    });
  }
  private async finishState(tx: Queryable, id: string) {
    await tx.query(
      `UPDATE assistant_profile_tasks SET state=CASE WHEN EXISTS(SELECT 1 FROM assistant_profile_task_items WHERE task_id=$1 AND state IN ('awaiting_review','uncertain','ready_to_save')) THEN 'waiting_review' ELSE 'completed' END,version=version+1,updated_at=now() WHERE id=$1 AND state='running'`,
      [id],
    );
  }
  async reconcileFinished() {
    const rows = (
      await this.db.query(
        `SELECT b.run_id FROM assistant_profile_task_runs b JOIN assistant_workspace_runs r ON r.id=b.run_id WHERE NOT b.settled AND r.status NOT IN ('queued','running')`,
      )
    ).rows;
    for (const r of rows) await this.reconcileTaskRun(r.run_id);
  }
  async reconcileTaskRun(runId: string) {
    await taskTransaction(this.db, async (tx) => {
      const b = (
        await tx.query(
          `SELECT b.*,r.status,r.checkpoint,t.actor_id,t.state FROM assistant_profile_task_runs b JOIN assistant_workspace_runs r ON r.id=b.run_id JOIN assistant_profile_tasks t ON t.id=b.task_id WHERE b.run_id=$1 AND NOT b.settled AND r.status NOT IN ('queued','running') FOR UPDATE OF t,b`,
          [runId],
        )
      ).rows[0];
      if (!b) return;
      const items = (
        await tx.query(
          "SELECT * FROM assistant_profile_task_items WHERE task_id=$1 AND id=ANY($2::uuid[]) FOR UPDATE",
          [b.task_id, b.item_ids],
        )
      ).rows;
      let progressed = false;
      for (const item of items) {
        if (item.state !== "researching") {
          progressed = true;
          continue;
        }
        const acts = (
          await tx.query(
            `SELECT a.*,m.result AS durable_result FROM assistant_workspace_actions a LEFT JOIN assistant_workspace_mutation_results m ON m.action_id=a.id AND m.actor_id=a.actor_id WHERE a.id=ANY($1::uuid[]) AND a.actor_id=$2`,
            [item.action_ids, b.actor_id],
          )
        ).rows;
        const receipts = acts.flatMap(
          (a) => (a.durable_result ?? a.result)?.receipts ?? [],
        );
        const uncertain = acts.some(
          (a) =>
            ["provider_started", "uncertain"].includes(a.status) &&
            !a.durable_result,
        );
        const review = acts.some(
          (a) => a.status === "proposed" || a.status === "prepared",
        );
        // Saving a note proves the note, never completion of the broader contact objective.
        const state = uncertain
          ? "uncertain"
          : review
            ? "awaiting_review"
            : receipts.length
              ? "needs_review"
              : b.status === "failed"
                ? item.attempts >= 3
                  ? "failed"
                  : "pending"
                : "pending";
        if (state !== "pending") progressed = true;
        await tx.query(
          "UPDATE assistant_profile_task_items SET state=$2,reason=$3,receipt_ids=$4::jsonb WHERE id=$1",
          [
            item.id,
            state,
            uncertain
              ? "reconciliation_required"
              : review
                ? "approval_required"
                : receipts.length
                  ? "saved_work_needs_objective_verification"
                  : b.status === "failed"
                    ? "run_failed"
                    : null,
            JSON.stringify(receipts.map((r) => r.id)),
          ],
        );
      }
      await tx.query(
        "UPDATE assistant_profile_task_runs SET settled=true WHERE run_id=$1",
        [runId],
      );
      const budget =
        JSON.stringify(b.checkpoint?.turn?.final ?? {}).match(
          /spending|allowance|Paid AI work/,
        ) ||
        Object.values(b.checkpoint?.turn?.results ?? {}).some((v: any) =>
          v.code?.includes("BUDGET"),
        );
      if (budget || (!progressed && b.status !== "failed"))
        await tx.query(
          "UPDATE assistant_profile_tasks SET state='paused',pause_reason=$2,version=version+1 WHERE id=$1 AND state='running'",
          [b.task_id, budget ? "budget" : "no_progress"],
        );
      else if (
        !(
          await tx.query(
            "SELECT id FROM assistant_profile_task_items WHERE task_id=$1 AND state='pending' LIMIT 1",
            [b.task_id],
          )
        ).rows.length
      )
        await this.finishState(tx, b.task_id);
      else
        await tx.query(
          "UPDATE assistant_profile_tasks SET version=version+1 WHERE id=$1",
          [b.task_id],
        );
    });
  }
}
