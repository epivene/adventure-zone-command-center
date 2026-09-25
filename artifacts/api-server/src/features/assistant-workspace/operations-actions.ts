import { z } from "zod";
import type {
  Queryable,
  RunContext,
  ActionIntent,
  ToolResult,
} from "./contracts";
import type { MutationAdapter } from "./action-executor";
import { transactionQueries } from "./transaction-queries";
import { DrizzleOfficeTaskRepository } from "../office/office-task-repository";
import { recordAuditEntry } from "../audit/audit-service";
import { blocked } from "./read-tools";
const fields = {
  taskType: z.enum([
    "contact_verification",
    "mail_brochure",
    "follow_up_prep",
    "research_update",
    "draft_email",
    "other",
  ]),
  title: z.string().trim().min(1).max(300),
  instructions: z.string().max(10000).nullable().optional(),
  organizationId: z.uuid().nullable(),
  contactId: z.uuid().nullable(),
  dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
};
export const operationsActionSchemas = {
  create_office_task: z.object(fields).strict(),
  update_office_task: z
    .object({
      ...fields,
      status: z
        .enum(["todo", "in_progress", "waiting", "done", "cancelled"])
        .optional(),
      needsHelp: z.boolean().optional(),
    })
    .partial()
    .strict()
    .refine((x) => Object.keys(x).length > 0, "An edit is required"),
};
async function target(
  q: Queryable,
  c: RunContext,
  i: ActionIntent,
  lock = false,
) {
  if (
    c.actor.role !== "owner" ||
    c.actor.id !== i.actorId ||
    c.conversationId !== i.conversationId
  )
    throw new Error("ASSISTANT_ACCESS_DENIED");
  const create = i.kind === "create_office_task",
    args: any = operationsActionSchemas[
      i.kind as keyof typeof operationsActionSchemas
    ].parse(i.arguments);
  const task = create
    ? null
    : (
        await q.query(
          `SELECT * FROM office_tasks WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
          [i.targetId],
        )
      ).rows[0];
  if (!create && !task) throw new Error("ASSISTANT_TASK_NOT_FOUND");
  const account = (
    await q.query(
      `SELECT id,display_name,role,enabled,updated_at FROM office_accounts WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
      [create ? i.targetId : task.office_account_id],
    )
  ).rows[0];
  if (!account || !account.enabled || account.role !== "office_coordinator")
    throw new Error("ASSISTANT_COORDINATOR_UNAVAILABLE");
  if (
    !i.expectedRevision ||
    new Date((create ? account : task).updated_at).toISOString() !==
      i.expectedRevision
  )
    throw new Error("ASSISTANT_VERSION_CONFLICT");
  const org =
      args.organizationId !== undefined
        ? args.organizationId
        : (task?.organization_id ?? null),
    contact =
      args.contactId !== undefined
        ? args.contactId
        : (task?.contact_id ?? null);
  // Both original and resulting customer must remain in the reviewed selection.
  if (
    [task?.organization_id, org]
      .filter(Boolean)
      .some((id) => !c.selection.organizationIds.includes(id))
  )
    throw new Error("ASSISTANT_TARGET_NOT_IN_BATCH");
  if (
    org &&
    !(
      await q.query(
        `SELECT id FROM organizations WHERE id=$1 AND consolidated_into_id IS NULL${lock ? " FOR SHARE" : ""}`,
        [org],
      )
    ).rows.length
  )
    throw new Error("ASSISTANT_PROFILE_NOT_FOUND");
  if (
    contact &&
    (!org ||
      !(
        await q.query(
          `SELECT contact_id FROM organization_contacts WHERE organization_id=$1 AND contact_id=$2 AND active=true${lock ? " FOR SHARE" : ""}`,
          [org, contact],
        )
      ).rows.length)
  )
    throw new Error("ASSISTANT_CONTACT_MISMATCH");
  return { args, task, account, org, contact };
}
export function operationsAdapters(
  database: any,
  read: Queryable,
): Record<string, MutationAdapter> {
  return Object.fromEntries(
    Object.keys(operationsActionSchemas).map((kind) => [
      kind,
      {
        async validate(c: RunContext, i: ActionIntent) {
          await target(read, c, i);
        },
        async apply(c: RunContext, i: ActionIntent) {
          return database.transaction(async (tx: any) => {
            const q = transactionQueries(tx);
            await q.query(
              "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
              [i.id],
            );
            const prior = (
              await q.query(
                "SELECT result FROM assistant_workspace_mutation_results WHERE action_id=$1 AND actor_id=$2",
                [i.id, c.actor.id],
              )
            ).rows[0];
            if (prior) return prior.result;
            const t = await target(q, c, i, true);
            if (c.signal.aborted) throw new Error("ASSISTANT_CANCELLED");
            const repo = new DrizzleOfficeTaskRepository(tx),
              input = {
                ...t.args,
                ...(t.args.dueAt !== undefined
                  ? {
                      dueAt:
                        t.args.dueAt === null ? null : new Date(t.args.dueAt),
                    }
                  : {}),
              };
            const saved =
              kind === "create_office_task"
                ? await repo.createForOwner({
                    ...input,
                    officeAccountId: t.account.id,
                  })
                : await repo.updateForOwner(i.targetId, input);
            if (!saved) throw new Error("ASSISTANT_TASK_NOT_FOUND");
            await recordAuditEntry(tx, {
              entityType: "office_task",
              entityId: saved.id,
              action: kind === "create_office_task" ? "created" : "updated",
              before: t.task,
              after: saved,
            });
            const output: ToolResult = {
              status: "ok",
              data: {
                record: saved,
                coordinator: {
                  id: t.account.id,
                  displayName: t.account.display_name,
                },
              },
              evidence: [],
              receipts: [
                {
                  kind: "office_task",
                  id: saved.id,
                  href: "/office-coordinator",
                  verifiedAt: new Date().toISOString(),
                },
              ],
              code: null,
            };
            await q.query(
              "INSERT INTO assistant_workspace_mutation_results(action_id,actor_id,result) VALUES($1,$2,$3::jsonb)",
              [i.id, c.actor.id, JSON.stringify(output)],
            );
            return output;
          });
        },
        async reconcile(c: RunContext, i: ActionIntent) {
          return (
            (
              await read.query(
                "SELECT result FROM assistant_workspace_mutation_results WHERE action_id=$1 AND actor_id=$2",
                [i.id, c.actor.id],
              )
            ).rows[0]?.result ??
            blocked("ASSISTANT_ACTION_RECONCILIATION_REQUIRED")
          );
        },
      },
    ]),
  );
}
export async function operationsActionPreview(
  q: Queryable,
  c: RunContext,
  i: ActionIntent,
) {
  if (!(i.kind in operationsActionSchemas)) return null;
  const t = await target(q, c, i);
  return {
    available: true,
    title: `${i.kind === "create_office_task" ? "New task" : "Edit task"} · ${t.account.display_name}`,
    summary: `${t.args.title ?? t.task.title}\nCoordinator: ${t.account.display_name}\nProfile: ${t.org ?? "No customer"} · Contact: ${t.contact ?? "None"}\nReviewed fields: ${JSON.stringify(t.args)}\nOmitted fields and coordinator notes are preserved.`,
    revision: i.expectedRevision,
    reviewHref: "/office-coordinator",
  };
}
