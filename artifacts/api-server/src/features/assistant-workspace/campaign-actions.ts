import { z } from "zod";
import type {
  Queryable,
  RunContext,
  ActionIntent,
  ToolResult,
} from "./contracts";
import type { MutationAdapter } from "./action-executor";
import { transactionQueries } from "./transaction-queries";
import { stableCampaignId } from "./campaign-store";
import { FollowUpService } from "../follow-ups/follow-up-service";
import { DrizzleFollowUpRepository } from "../follow-ups/follow-up-repository";
import { blocked } from "./read-tools";
export const sendFollowupSchema = z
  .object({
    daysAfter: z.number().int().min(1).max(365),
    kind: z.string().trim().min(1).max(200),
  })
  .strict();
async function source(
  q: Queryable,
  c: RunContext,
  i: ActionIntent,
  lock = false,
) {
  const args = sendFollowupSchema.parse(i.arguments);
  const d = (
    await q.query(
      `SELECT * FROM assistant_workspace_drafts WHERE id=$1 AND actor_id=$2 AND conversation_id=$3${lock ? " FOR UPDATE" : ""}`,
      [i.targetId, c.actor.id, c.conversationId],
    )
  ).rows[0];
  if (!d || c.actor.role !== "owner")
    throw new Error("ASSISTANT_DRAFT_NOT_FOUND");
  if (!i.expectedRevision || i.expectedRevision !== d.revision)
    throw new Error("ASSISTANT_VERSION_CONFLICT");
  const content = d.content;
  if (
    !c.selection.organizationIds.includes(content.organizationId) ||
    !content.eventYear ||
    c.selection.eventYear !== content.eventYear ||
    (c.selection.bookingId && c.selection.bookingId !== content.bookingId)
  )
    throw new Error("ASSISTANT_TARGET_NOT_IN_BATCH");
  const sent = (
    await q.query(
      "SELECT result FROM assistant_workspace_actions WHERE actor_id=$1 AND conversation_id=$2 AND kind='send_draft' AND target_id=$3 AND expected_revision=$4 AND status='succeeded' ORDER BY created_at DESC LIMIT 1",
      [c.actor.id, c.conversationId, d.id, d.revision],
    )
  ).rows[0]?.result;
  const date = new Date(sent?.data?.sentAt);
  if (
    typeof sent?.data?.messageId !== "string" ||
    !sent.data.messageId ||
    !z.iso.datetime({ offset: true }).safeParse(sent?.data?.sentAt).success ||
    d.status !== "sent" ||
    sent?.status !== "ok" ||
    sent.data?.delivery !== "sent" ||
    !Number.isFinite(date.getTime()) ||
    !sent.receipts?.some(
      (r: any) =>
        r.kind === "sent_email" &&
        r.id === sent.data.messageId &&
        Number.isFinite(new Date(r.verifiedAt).getTime()),
    )
  )
    throw new Error("ASSISTANT_CONFIRMED_SEND_REQUIRED");
  if (
    !(
      await q.query(
        `SELECT id FROM organizations WHERE id=$1 AND consolidated_into_id IS NULL${lock ? " FOR UPDATE" : ""}`,
        [content.organizationId],
      )
    ).rows.length
  )
    throw new Error("ASSISTANT_PROFILE_NOT_FOUND");
  if (
    content.contactId &&
    !(
      await q.query(
        `SELECT contact_id FROM organization_contacts WHERE organization_id=$1 AND contact_id=$2 AND active=true${lock ? " FOR SHARE" : ""}`,
        [content.organizationId, content.contactId],
      )
    ).rows.length
  )
    throw new Error("ASSISTANT_CONTACT_MISMATCH");
  if (
    content.bookingId &&
    !(
      await q.query(
        "SELECT id FROM bookings WHERE id=$1 AND organization_id=$2",
        [content.bookingId, content.organizationId],
      )
    ).rows.length
  )
    throw new Error("ASSISTANT_BOOKING_MISMATCH");
  return {
    args,
    content,
    messageId: sent.data.messageId,
    sentAt: date,
    dueAt: new Date(date.getTime() + args.daysAfter * 86400000),
  };
}
export function campaignAdapters(
  database: any,
  read: Queryable,
): Record<string, MutationAdapter> {
  return {
    create_send_followup: {
      async validate(c, i) {
        await source(read, c, i);
      },
      async apply(c, i) {
        return database.transaction(async (tx: any) => {
          const q = transactionQueries(tx);
          await q.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
            [i.id],
          );
          const previous = (
            await q.query(
              "SELECT result FROM assistant_workspace_mutation_results WHERE action_id=$1 AND actor_id=$2",
              [i.id, c.actor.id],
            )
          ).rows[0];
          if (previous) return previous.result;
          const s = await source(q, c, i, true);
          const id = stableCampaignId(
            `send-followup:${c.actor.id}:${s.content.organizationId}:${s.messageId}`,
          );
          const existing = (
            await q.query("SELECT * FROM follow_ups WHERE id=$1", [id])
          ).rows[0];
          if (
            existing &&
            (existing.organization_id !== s.content.organizationId ||
              existing.contact_id !== (s.content.contactId ?? null) ||
              existing.booking_id !== (s.content.bookingId ?? null) ||
              existing.kind !== s.args.kind ||
              new Date(existing.due_at).getTime() !== s.dueAt.getTime())
          )
            throw new Error("ASSISTANT_FOLLOWUP_CONFLICT");
          if (c.signal.aborted) throw new Error("ASSISTANT_CANCELLED");
          const saved = await new FollowUpService(
            new DrizzleFollowUpRepository(tx),
          ).create(
            {
              organizationId: s.content.organizationId,
              contactId: s.content.contactId ?? null,
              bookingId: s.content.bookingId ?? null,
              kind: s.args.kind,
              dueAt: s.dueAt,
            },
            { preserveExisting: true, idempotencyId: id },
          );
          if (!saved.ok) throw new Error("ASSISTANT_FOLLOWUP_FAILED");
          const output: ToolResult = {
            status: "ok",
            data: {
              record: saved.value,
              messageId: s.messageId,
              sentAt: s.sentAt.toISOString(),
              dueAt: s.dueAt.toISOString(),
            },
            evidence: [],
            receipts: [
              {
                kind: "follow_up",
                id,
                href: `/profiles/${s.content.organizationId}`,
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
      async reconcile(c, i) {
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
  };
}
export async function campaignActionPreview(
  q: Queryable,
  c: RunContext,
  i: ActionIntent,
) {
  if (i.kind !== "create_send_followup") return null;
  const s = await source(q, c, i);
  return {
    available: true,
    title: "Follow-up after confirmed send",
    summary: `Create ${s.args.kind} on ${s.dueAt.toISOString()} (${s.args.daysAfter} days after confirmed send ${s.messageId}). Existing reminders are preserved.`,
    targetId: i.targetId,
    revision: i.expectedRevision,
    reviewHref: `/profiles/${s.content.organizationId}`,
    approvalBlocked: false,
  };
}
