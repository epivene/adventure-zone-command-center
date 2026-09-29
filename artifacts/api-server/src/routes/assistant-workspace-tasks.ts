import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { z } from "zod";
import type { WorkspaceRuntime } from "../features/assistant-workspace/runtime";
import { taskScopeSchema } from "../features/assistant-workspace/profile-task-contracts";
import { compileTaskAuthority } from "../features/assistant-workspace/profile-task-policy";
const uuid = z.string().uuid();
export function createProfileTaskRouter(
  runtime: () => WorkspaceRuntime,
  enabled = () => process.env.ASSISTANT_PROFILE_TASKS_ENABLED === "true",
) {
  const router = Router();
  router.use("/tasks", (_q, s, n) => {
    if (!enabled()) {
      s.status(404).json({ code: "ASSISTANT_PROFILE_TASKS_DISABLED" });
      return;
    }
    s.set("Cache-Control", "no-store");
    n();
  });
  const wrap =
    (
      fn: (
        q: Request,
        s: Response,
        r: WorkspaceRuntime,
        a: string,
      ) => Promise<unknown>,
    ) =>
    (q: Request, s: Response, n: NextFunction) => {
      void fn(q, s, runtime(), s.locals.actorId).catch(n);
    };
  router.get(
    "/tasks",
    wrap(async (q, s, r, a) =>
      s.json(
        await Promise.all(
          (
            await r.profileTasks.list(a, uuid.parse(q.query.conversationId))
          ).map((t) => r.taskView(t)),
        ),
      ),
    ),
  );
  router.get(
    "/tasks/:id",
    wrap(async (q, s, r, a) => {
      const t = await r.profileTasks.get(a, uuid.parse(q.params.id));
      s.status(t ? 200 : 404).json(
        t ? await r.taskView(t) : { code: "ASSISTANT_TASK_NOT_FOUND" },
      );
    }),
  );
  router.post(
    "/tasks",
    wrap(async (q, s, r, a) => {
      const input = z
        .object({
          conversationId: uuid,
          sourceMessageId: uuid,
          requestKey: z.string().min(1).max(200),
          scope: taskScopeSchema,
          explicitActions: z
            .array(z.enum(["add_profile_note", "update_profile"]))
            .max(2),
        })
        .strict()
        .parse(q.body);
      await r.validateTaskProfiles(input.scope.profileIds);
      const authority = compileTaskAuthority({
        actorId: a,
        sourceMessageId: input.sourceMessageId,
        scope: input.scope,
        explicitActions: input.explicitActions,
      });
      s.status(201).json(
        await r.profileTasks.create(
          a,
          input.conversationId,
          input.requestKey,
          input.scope,
          authority,
        ),
      );
    }),
  );
  router.post(
    "/tasks/:id/commands",
    wrap(async (q, s, r, a) => {
      const input = z
        .object({
          requestKey: z.string().min(1).max(200),
          expectedVersion: z.number().int().positive(),
          command: z.enum(["pause", "resume", "cancel", "retry", "skip"]),
          itemIds: z.array(uuid).max(4).optional(),
          completionMode: z
            .enum(["manual", "sourced_notes", "profile_fields"])
            .optional(),
        })
        .strict()
        .parse(q.body);
      const task = await r.profileTasks.command(
        a,
        uuid.parse(q.params.id),
        input.expectedVersion,
        input.command,
        input.itemIds,
        input.requestKey,
        input.completionMode,
      );
      s.json(task);
      void r.worker.tick().catch(() => {});
    }),
  );
  router.post(
    "/tasks/:id/approvals",
    wrap(async (q, s, r, a) => {
      const input = z
        .object({
          requestKey: z.string().min(1).max(200),
          expectedVersion: z.number().int().positive(),
          actions: z
            .array(
              z.object({ id: uuid, revision: z.string().nullable() }).strict(),
            )
            .min(1)
            .max(4),
        })
        .strict()
        .parse(q.body);
      const task = await r.profileTasks.get(a, uuid.parse(q.params.id));
      if (!task) throw Error("ASSISTANT_ACCESS_DENIED");
      if (
        task.version !== input.expectedVersion ||
        ["cancelled", "completed", "proposed"].includes(task.state)
      )
        throw Error("ASSISTANT_TASK_CONFLICT");
      const outputs = [];
      for (const approval of input.actions) {
        const action = await r.actions.get(a, approval.id);
        if (
          !action ||
          !task.items.some((i) => i.actionIds.includes(action.id)) ||
          action.conversationId !== task.conversationId ||
          !["add_profile_note", "update_profile"].includes(action.kind) ||
          !task.scope.profileIds.includes(action.targetId)
        )
          throw Error("ASSISTANT_ACCESS_DENIED");
        if (action.expectedRevision !== approval.revision) {
          outputs.push({ actionId: action.id, status: "conflict" });
          continue;
        }
        await r.conversations.append(
          a,
          task.conversationId,
          `task-approve:${input.requestKey}:${action.id}`,
          {
            role: "user",
            text: `Approve task update ${action.id} at revision ${approval.revision ?? "new"}`,
          },
        );
        const output = await r.executor.execute(
          {
            actor: { id: a, role: "owner", connectionId: null },
            conversationId: task.conversationId,
            runId: `ui:${input.requestKey}`,
            taskId: task.id,
            taskReview: true,
            taskVersion: input.expectedVersion,
            selection: {
              organizationIds: [action.targetId],
              eventYear: task.scope.eventYear,
              bookingId: null,
              threadId: null,
              draftId: null,
            },
            grants: [
              {
                actorId: a,
                sourceMessageId: action.sourceMessageId,
                actionKind: action.kind,
                targetIds: [action.targetId],
                revision: action.expectedRevision,
                connectionId: null,
              },
            ],
            signal: new AbortController().signal,
          },
          action,
        );
        if (output.status === "ok")
          await r.profileTasks.db.query(
            "UPDATE assistant_profile_task_items i SET state=CASE WHEN EXISTS (SELECT 1 FROM assistant_workspace_actions a WHERE i.action_ids @> jsonb_build_array(a.id::text) AND a.status='prepared') THEN 'awaiting_review' ELSE 'needs_review' END,reason='approved_change_saved_verify_objective',receipt_ids=receipt_ids || $3::jsonb WHERE task_id=$1 AND action_ids @> $2::jsonb",
            [
              task.id,
              JSON.stringify([action.id]),
              JSON.stringify(output.receipts.map((x) => x.id)),
            ],
          );
        if (
          output.status === "blocked" &&
          [
            "ASSISTANT_VERSION_CONFLICT",
            "ASSISTANT_PROFILE_NOT_FOUND",
            "ASSISTANT_TASK_CONFLICT",
          ].includes(output.code ?? "")
        )
          await r.profileTasks.db.query(
            "UPDATE assistant_profile_task_items SET state='needs_review',reason=$3 WHERE task_id=$1 AND action_ids @> $2::jsonb",
            [
              task.id,
              JSON.stringify([action.id]),
              output.code === "ASSISTANT_VERSION_CONFLICT"
                ? "revision_changed_retry_to_refresh"
                : "profile_or_task_changed",
            ],
          );
        if (output.status === "uncertain")
          await r.profileTasks.db.query(
            "UPDATE assistant_profile_task_items SET state='uncertain',reason='reconciliation_required' WHERE task_id=$1 AND action_ids @> $2::jsonb",
            [task.id, JSON.stringify([action.id])],
          );
        outputs.push({ actionId: action.id, ...output });
      }
      await r.profileTasks.db.query(
        "UPDATE assistant_profile_tasks SET version=version+1 WHERE id=$1 AND version=$2",
        [task.id, input.expectedVersion],
      );
      s.json({ results: outputs });
    }),
  );
  router.use((e: Error, _q: Request, s: Response, n: NextFunction) => {
    if (
      e.message === "ASSISTANT_TASK_CONFLICT" ||
      e.message === "ASSISTANT_VERSION_CONFLICT"
    )
      s.status(409).json({ code: e.message });
    else n(e);
  });
  return router;
}
