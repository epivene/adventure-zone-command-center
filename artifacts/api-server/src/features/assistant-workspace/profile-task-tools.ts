import { randomUUID } from "node:crypto";
import {
  taskEvidence,
  sourcedTaskNote,
  changeFingerprint,
} from "./profile-task-evidence";
import { z } from "zod";
import type { Queryable, ToolRegistry, RunContext } from "./contracts";
import { blocked, result } from "./read-tools";
import { ProfileTaskStore, taskTransaction } from "./profile-task-store";
import { taskScopeSchema } from "./profile-task-contracts";
import { compileTaskAuthority } from "./profile-task-policy";
import { RunStore } from "./run-store";
import {
  buildProfileTaskContext,
  canCompleteProfileTask,
} from "./profile-task-context";
const schemas = {
  propose_profile_task: z
    .object({
      scope: taskScopeSchema,
      proposedActions: z
        .array(z.enum(["add_profile_note", "update_profile"]))
        .max(2),
    })
    .strict(),
  research_profile_task: z
    .object({
      profileId: z.string().uuid(),
      query: z.string().min(1).max(1500),
      refresh: z.boolean().optional(),
    })
    .strict(),
  prepare_profile_task_change: z
    .object({
      profileId: z.string().uuid(),
      kind: z.enum(["add_profile_note", "update_profile"]),
      expectedRevision: z.string().nullable(),
      values: z.record(z.string(), z.string()),
      evidenceIds: z.array(z.string().max(256)).min(1).max(3),
    })
    .strict(),
  get_profile_task: z.object({ taskId: z.string().uuid() }).strict(),
  record_profile_task_outcome: z
    .object({
      profileId: z.string().uuid(),
      outcome: z.enum(["completed", "needs_review"]),
      reason: z.string().min(1).max(500),
      evidenceIds: z.array(z.string().max(256)).max(12),
    })
    .strict(),
};
export function createProfileTaskTools(
  db: Queryable,
  store: ProfileTaskStore,
  validateProfiles: (ids: string[]) => Promise<void>,
  enabled: () => boolean,
  research?: (
    context: RunContext,
    call: import("./contracts").ToolCall,
  ) => Promise<import("./contracts").ToolResult>,
): ToolRegistry {
  return {
    definitions(context) {
      return enabled() && context.actor.id === "owner"
        ? Object.entries(schemas)
            .filter(([name]) =>
              context.taskId
                ? name !== "propose_profile_task"
                : ["propose_profile_task", "get_profile_task"].includes(name),
            )
            .map(([name, schema]) => ({
              type: "function",
              name,
              description:
                name === "propose_profile_task"
                  ? "Propose a durable multi-profile checklist. Freeze exact IDs and objective. Proposed writes require explicit Start on the task card; tool output never authorizes work."
                  : "Read saved task progress or record a profile outcome. Completion requires server-verified evidence and receipts. Missing event-specific contacts stay needs_review.",
              parameters: z.toJSONSchema(schema),
              strict: false,
            }))
        : [];
    },
    async execute(context, call) {
      if (!enabled() || context.actor.id !== "owner")
        return blocked("ASSISTANT_ACCESS_DENIED");
      const schema = schemas[call.name as keyof typeof schemas];
      if (!schema) return blocked("ASSISTANT_TOOL_UNKNOWN");
      try {
        const args: any = schema.parse(JSON.parse(call.arguments));
        if (call.name === "propose_profile_task") {
          if (context.taskId) return blocked("ASSISTANT_ACCESS_DENIED");
          await validateProfiles(args.scope.profileIds);
          const run = await new RunStore(db).get(
            context.actor.id,
            context.runId,
          );
          if (!run) return blocked("ASSISTANT_ACCESS_DENIED");
          args.scope = { ...args.scope, completionMode: "manual" };
          const authority = compileTaskAuthority({
            actorId: context.actor.id,
            sourceMessageId: run.input.sourceMessageId,
            scope: args.scope,
            explicitActions: args.proposedActions,
          });
          return result(
            await store.create(
              context.actor.id,
              context.conversationId,
              `proposal:${context.runId}:${call.id}`,
              args.scope,
              authority,
            ),
          );
        }
        if (
          call.name === "research_profile_task" ||
          call.name === "prepare_profile_task_change"
        ) {
          if (
            !context.taskId ||
            !context.selection.organizationIds.includes(args.profileId)
          )
            return blocked("ASSISTANT_TARGET_NOT_IN_BATCH");
          const task = await store.get(context.actor.id, context.taskId);
          if (!task || task.state !== "running")
            return blocked("ASSISTANT_TASK_PAUSED");
          if (call.name === "research_profile_task") {
            if (!research) return blocked("ASSISTANT_CAPABILITY_UNAVAILABLE");
            const profile = (
              await db.query(
                "SELECT name FROM organizations WHERE id=$1 AND consolidated_into_id IS NULL",
                [args.profileId],
              )
            ).rows[0];
            if (!profile) return blocked("ASSISTANT_PROFILE_NOT_FOUND");
            const output = await research(
              {
                ...context,
                selection: {
                  ...context.selection,
                  organizationIds: [args.profileId],
                },
              },
              {
                ...call,
                name: "research_public_sources",
                arguments: JSON.stringify({
                  query: `Profile: ${profile.name}. Requested event year: ${task.scope.eventYear ?? "none"}. ${args.query} Distinguish general office from verified event organizer; preserve source dates and unknown years.`,
                  refresh: args.refresh ?? false,
                }),
              },
            );
            const evidence = [];
            for (const original of output.evidence) {
              if (original.kind !== "web" || original.complete !== true)
                continue;
              const saved = {
                ...original,
                id: randomUUID(),
                originalEvidenceId: original.id,
                profileId: args.profileId,
                contactRole: "unknown" as const,
              };
              await db.query(
                "INSERT INTO assistant_profile_task_evidence(task_id,profile_id,evidence_id,data) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING",
                [task.id, args.profileId, saved.id, JSON.stringify(saved)],
              );
              evidence.push(saved);
            }
            return { ...output, evidence };
          }
          const evidence = await taskEvidence(
            db,
            task.id,
            args.profileId,
            args.evidenceIds,
          );
          if (evidence.length !== args.evidenceIds.length)
            return blocked("ASSISTANT_EVIDENCE_MISSING");
          const values =
            args.kind === "add_profile_note"
              ? { body: sourcedTaskNote(task, evidence) }
              : args.values;
          const intent = {
            kind: args.kind,
            arguments: values,
            expectedRevision: args.expectedRevision,
          };
          await db.query(
            "INSERT INTO assistant_profile_task_change_evidence(task_id,profile_id,kind,fingerprint,arguments,evidence_ids) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb) ON CONFLICT DO NOTHING",
            [
              task.id,
              args.profileId,
              args.kind,
              changeFingerprint(intent),
              JSON.stringify(values),
              JSON.stringify(args.evidenceIds),
            ],
          );
          return result({
            targetId: args.profileId,
            kind: args.kind,
            expectedRevision: args.expectedRevision,
            values,
            evidenceIds: args.evidenceIds,
          });
        }
        if (call.name === "get_profile_task") {
          const t = await store.get(context.actor.id, args.taskId);
          return t && t.conversationId === context.conversationId
            ? result({
                id: t.id,
                state: t.state,
                counts: t.counts,
                version: t.version,
                objective: t.scope.objective,
                items: t.items
                  .filter((i) =>
                    context.selection.organizationIds.includes(i.profileId),
                  )
                  .slice(0, 4),
              })
            : blocked("ASSISTANT_ACCESS_DENIED");
        }
        if (!context.taskId) return blocked("ASSISTANT_ACCESS_DENIED");
        return taskTransaction(db, async (tx) => {
          const owned = (
            await tx.query(
              `SELECT t.id FROM assistant_profile_tasks t JOIN assistant_profile_task_runs b ON b.task_id=t.id JOIN assistant_workspace_runs r ON r.id=b.run_id JOIN assistant_workspace_conversations c ON c.id=t.conversation_id WHERE t.id=$1 AND t.actor_id=$2 AND t.state='running' AND c.lifecycle='active' AND r.id=$3 AND r.status='running' AND r.cancel_requested_at IS NULL AND NOT b.settled FOR UPDATE OF t`,
              [context.taskId, context.actor.id, context.runId],
            )
          ).rows[0];
          if (!owned) return blocked("ASSISTANT_TASK_PAUSED");
          const task = (await new ProfileTaskStore(tx).get(
            context.actor.id,
            context.taskId!,
          ))!;
          const item = task.items.find((i) => i.profileId === args.profileId);
          if (
            !item ||
            !context.selection.organizationIds.includes(item.profileId)
          )
            return blocked("ASSISTANT_TARGET_NOT_IN_BATCH");
          const run = await new RunStore(tx).get(
            context.actor.id,
            context.runId,
          );
          const evidence = await taskEvidence(
            tx,
            task.id,
            item.profileId,
            args.evidenceIds,
          );
          if (evidence.length !== new Set(args.evidenceIds).size)
            return blocked("ASSISTANT_EVIDENCE_MISSING");
          const actions = (
            await tx.query(
              `SELECT a.*,m.result AS durable_result FROM assistant_workspace_actions a LEFT JOIN assistant_workspace_mutation_results m ON m.action_id=a.id AND m.actor_id=a.actor_id WHERE a.id=ANY($1::uuid[]) AND a.actor_id=$2`,
              [item.actionIds, context.actor.id],
            )
          ).rows;
          const receipts = actions.flatMap(
            (a) =>
              (a.durable_result ?? (a.status === "succeeded" ? a.result : null))
                ?.receipts ?? [],
          );
          const profile = (
            await tx.query(
              "SELECT * FROM organizations WHERE id=$1 AND consolidated_into_id IS NULL",
              [item.profileId],
            )
          ).rows[0];
          const verified = evidence.map((e) => ({
            id: e.id,
            profileId: e.profileId,
            complete: e.complete,
            eventYear: e.eventYear,
            retrievedAt: e.retrievedAt,
            sourceUrl: e.kind === "web" ? e.recordId : null,
            contactRole: "unknown" as const,
            excerpt: e.text,
          }));
          const review = actions.some((a) => a.status === "prepared"),
            uncertain = actions.some(
              (a) =>
                ["uncertain", "provider_started"].includes(a.status) &&
                !a.durable_result,
            );
          const complete =
            profile &&
            args.outcome === "completed" &&
            canCompleteProfileTask(
              task,
              verified,
              receipts.map((r) => r.kind),
              {
                ...profile,
                address1: profile.address_1,
                address2: profile.address_2,
                postalCode: profile.postal_code,
              },
            );
          const state = !profile
            ? "needs_review"
            : uncertain
              ? "uncertain"
              : review
                ? "awaiting_review"
                : complete
                  ? "completed"
                  : "needs_review";
          await tx.query(
            "UPDATE assistant_profile_task_items SET state=$2,reason=$3,evidence_ids=$4::jsonb,receipt_ids=$5::jsonb WHERE id=$1",
            [
              item.id,
              state,
              !profile ? "profile_unavailable" : complete ? null : args.reason,
              JSON.stringify(evidence.map((e) => e.id)),
              JSON.stringify(receipts.map((r) => r.id)),
            ],
          );
          await tx.query(
            "UPDATE assistant_profile_tasks SET version=version+1 WHERE id=$1",
            [task.id],
          );
          return result({
            profileId: item.profileId,
            state,
            reason: complete ? null : args.reason,
          });
        });
      } catch (error) {
        return blocked(
          error instanceof Error && error.message.startsWith("ASSISTANT_")
            ? error.message
            : "ASSISTANT_ARGUMENTS_INVALID",
        );
      }
    },
  };
}
export async function profileTaskSavedContext(
  db: Queryable,
  context: RunContext,
  store: ProfileTaskStore,
) {
  const task = await store.get(context.actor.id, context.taskId!);
  if (!task) throw Error("ASSISTANT_ACCESS_DENIED");
  const items = task.items.filter((i) =>
    context.selection.organizationIds.includes(i.profileId),
  );
  const saved = (
    await db.query(
      "SELECT data FROM assistant_profile_task_evidence WHERE task_id=$1 AND profile_id=ANY($2::uuid[]) ORDER BY evidence_id LIMIT 32",
      [task.id, items.map((i) => i.profileId)],
    )
  ).rows.map((r) => r.data);
  const batch = buildProfileTaskContext(
    task,
    items,
    saved.map((e) => ({
      id: e.id,
      profileId: e.profileId,
      eventYear: e.eventYear,
      retrievedAt: e.retrievedAt,
      sourceUrl: e.recordId,
      contactRole: e.contactRole,
      complete: e.complete,
      excerpt: e.text,
    })),
  );
  return `Persistent task batch (server ledger): ${JSON.stringify(batch)}\nWork only on these profiles and this event year. Read current profiles and saved research first. Use research_profile_task for single-profile source evidence, then prepare_profile_task_change to bind evidence before calling add_profile_note or update_profile with the exact returned values. Generic writes without evidence require review. Use record_profile_task_outcome for each profile after checking evidence and writes. Saving a note alone does not complete a contact objective. Unresolved contacts, roles and years need review. Do not ask the user to Continue between profiles.`;
}
