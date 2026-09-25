import type { CampaignStore } from "./campaign-store";
import { ActionStore } from "./action-store";
import { KnowledgeRepository } from "./knowledge";
import { assertApprovedDraftLinks } from "./draft-tools";
import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  ToolRegistry,
  RunContext,
  ActionIntent,
  Queryable,
} from "./contracts";
import { blocked, result } from "./read-tools";
import type { ConversationStore } from "./conversation-store";
import type { DraftStore } from "./draft-store";
import { draftContentSchema } from "./draft-store";
import type { DocumentReader } from "./document-reader";
import type { ActionExecutor } from "./action-executor";
import { recordSchemas, validateRecordAction } from "./record-tools";
import type { RunStore } from "./run-store";
const stableId = (s: string) => {
  const h = createHash("sha256").update(s).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const uuid = z.string().uuid();
const timed = z
  .object({
    calendarId: z.string().min(1),
    summary: z.string().min(1).max(300),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    timeZone: z.string().min(1),
    organizationId: uuid,
    bookingId: uuid.nullable(),
  })
  .strict();
const schemas = {
  create_calendar_event: z
    .object({
      targetId: z.string().min(1),
      expectedRevision: z.string().nullable(),
      values: timed,
    })
    .strict(),
  update_calendar_event: z
    .object({
      targetId: z.string().min(1),
      expectedRevision: z.string().min(1),
      values: timed,
    })
    .strict(),
  select_profiles: z
    .object({
      organizationIds: z.array(uuid).min(1).max(100),
      eventYear: z.number().int().min(2000).max(2200).nullable(),
    })
    .strict(),
  read_document: z
    .object({
      documentId: uuid.nullable(),
      messageId: z.string().max(256).nullable(),
      attachmentId: z.string().max(1024).nullable(),
    })
    .strict(),
  read_draft: z.object({ draftId: uuid }).strict(),
  list_drafts: z.object({}).strict(),
  list_actions: z.object({}).strict(),
  read_rules: z
    .object({
      organizationId: uuid.nullable(),
      eventYear: z.number().int().min(2000).max(2200).nullable(),
    })
    .strict(),
  prepare_draft: draftContentSchema,
  update_draft: z
    .object({
      draftId: uuid,
      revision: z.string().min(1),
      subject: z.string().min(1).max(300),
      html: z.string().min(1).max(150000),
      text: z.string().min(1).max(30000),
    })
    .strict(),
  ...Object.fromEntries(
    Object.entries(recordSchemas).map(([kind, schema]) => [
      kind,
      z
        .object({
          targetId: z.string().min(1).max(256),
          expectedRevision: z.string().nullable(),
          values: schema,
        })
        .strict(),
    ]),
  ),
};
export function createWorkspaceTools(deps: {
  campaigns?: CampaignStore;
  ownerId: string;
  db: Queryable;
  conversations: ConversationStore;
  drafts: DraftStore;
  reader: DocumentReader;
  executor: ActionExecutor;
  runs: RunStore;
  connectionFor(kind: string): Promise<string | null>;
}): ToolRegistry {
  const knowledge = new KnowledgeRepository(deps.db);
  const rules = async (organizationIds: string[], eventYear: number | null) => {
    const records = (
      await Promise.all(
        (organizationIds.length ? organizationIds : [null]).map(
          (organizationId) =>
            knowledge.list({
              organizationId,
              eventYear,
              at: new Date().toISOString().slice(0, 10),
            }),
        ),
      )
    ).flat();
    return [...new Map(records.map((r) => [r.id, r])).values()].map((r) => ({
      id: r.id,
      kind: "rule" as const,
      recordId: r.ruleKey,
      eventYear: r.eventYear,
      occurredAt: null,
      retrievedAt: new Date().toISOString(),
      version: String(r.version),
      complete: true,
      text: JSON.stringify(r),
    }));
  };
  return {
    definitions(context) {
      if (context.actor.id !== deps.ownerId) return [];
      return Object.entries(schemas).map(([name, schema]) => ({
        type: "function",
        name,
        description:
          name === "prepare_draft"
            ? "Prepare an editable in-app draft using a currently active reviewed template and its exact version. Every To/CC address must be an active contact linked to the selected profile; read_profile lists these. This never sends email. Read relevant sources first, keep verified terms, use only approved template links, and do not invent URLs. Uncertain payment status can be phrased as a neutral question; a payment record is not required to draft."
            : `Perform ${name.replaceAll("_", " ")}. Changes require the selected profile and exact record revision.`,
        parameters: z.toJSONSchema(schema, {
          io: "input",
          unrepresentable: "any",
        }),
        strict: false,
      }));
    },
    async execute(context, call) {
      if (context.actor.id !== deps.ownerId || context.signal.aborted)
        return blocked("ASSISTANT_ACCESS_DENIED");
      const schema = schemas[call.name as keyof typeof schemas];
      if (!schema) return blocked("ASSISTANT_TOOL_UNKNOWN");
      let args: any;
      try {
        args = schema.parse(JSON.parse(call.arguments));
      } catch {
        return blocked("ASSISTANT_ARGUMENTS_INVALID");
      }
      try {
        if (call.name === "read_draft") {
          const draft = await deps.drafts.get(context.actor.id, args.draftId);
          if (
            !draft ||
            draft.conversationId !== context.conversationId ||
            !context.selection.organizationIds.includes(
              draft.content.organizationId ?? "",
            )
          )
            return blocked("ASSISTANT_DRAFT_NOT_FOUND");
          return result(draft);
        }
        if (call.name === "list_actions")
          return result(
            await new ActionStore(deps.db).list(
              context.actor.id,
              context.conversationId,
            ),
          );
        if (call.name === "list_drafts")
          return result(
            await deps.drafts.list(context.actor.id, context.conversationId),
          );
        if (call.name === "read_rules") {
          if (
            args.organizationId &&
            !context.selection.organizationIds.includes(args.organizationId)
          )
            return blocked("ASSISTANT_TARGET_NOT_IN_BATCH");
          return {
            ...result(null),
            evidence: await rules(
              args.organizationId ? [args.organizationId] : [],
              args.eventYear,
            ),
          };
        }
        if (call.name === "select_profiles") {
          if (context.selection.batchId) {
            const batch = await deps.campaigns?.get(
              context.actor.id,
              context.conversationId,
              context.selection.batchId,
            );
            if (
              !batch ||
              args.eventYear !== batch.eventYear ||
              args.organizationIds.some(
                (id: string) =>
                  !batch.members.some((m) => m.organizationId === id),
              )
            )
              return blocked("ASSISTANT_TARGET_NOT_IN_BATCH");
          }
          const found = await deps.db.query(
            `SELECT id FROM organizations WHERE id=ANY($1::uuid[]) AND consolidated_into_id IS NULL`,
            [args.organizationIds],
          );
          if (found.rows.length !== new Set(args.organizationIds).size)
            return blocked("ASSISTANT_PROFILE_NOT_FOUND");
          const current = await deps.conversations.get(
            context.actor.id,
            context.conversationId,
          );
          if (!current) return blocked("ASSISTANT_CONVERSATION_NOT_FOUND");
          const selection = {
            ...current.selection,
            organizationIds: [...new Set(args.organizationIds)] as string[],
            eventYear: args.eventYear,
          };
          if (
            JSON.stringify(selection.organizationIds) !==
              JSON.stringify(current.selection.organizationIds) ||
            selection.eventYear !== current.selection.eventYear
          ) {
            selection.bookingId = null;
            selection.threadId = null;
            selection.draftId = null;
          }
          const saved = await deps.conversations.setSelection(
            context.actor.id,
            context.conversationId,
            current.version,
            selection,
          );
          Object.assign(context.selection, saved.selection);
          return {
            ...result(saved.selection),
            evidence: await rules(
              saved.selection.organizationIds,
              saved.selection.eventYear,
            ),
          };
        }
        if (call.name === "read_document")
          return deps.reader.read(
            context,
            args.documentId
              ? { documentId: args.documentId }
              : { messageId: args.messageId, attachmentId: args.attachmentId },
          );
        if (call.name === "prepare_draft") {
          args.batchId = context.selection.batchId ?? null;
          args.contactId = null;
          args.eventYear = context.selection.eventYear;
          args.bookingId = context.selection.bookingId;
          if (
            !args.organizationId ||
            !context.selection.organizationIds.includes(args.organizationId)
          )
            return blocked("ASSISTANT_TARGET_NOT_IN_BATCH");
          const template = await deps.db.query(
            `SELECT id,template_version,body_template FROM communication_templates WHERE id=$1 AND state='active' AND reviewed_at IS NOT NULL`,
            [args.templateId],
          );
          if (
            !template.rows[0] ||
            template.rows[0].template_version !== args.templateVersion
          )
            return blocked("ASSISTANT_CURRENT_TEMPLATE_REQUIRED");
          const approvedTemplates = await deps.db.query(
            "SELECT body_template FROM communication_templates WHERE state='active' AND reviewed_at IS NOT NULL",
          );
          assertApprovedDraftLinks(
            approvedTemplates.rows.map((t) => t.body_template).join("\n"),
            args.html,
          );
          const contacts = await deps.db.query(
            `SELECT lower(trim(c.email)) AS email FROM contacts c JOIN organization_contacts oc ON oc.contact_id=c.id WHERE oc.organization_id=$1 AND oc.active=true`,
            [args.organizationId],
          );
          const emails = new Set(contacts.rows.map((c) => c.email));
          if (
            [...args.to, ...args.cc].some(
              (email: string) => !emails.has(email.trim().toLowerCase()),
            )
          )
            return blocked("ASSISTANT_RECIPIENT_REVIEW_REQUIRED");
          const draft =
            context.selection.batchId && deps.campaigns
              ? await deps.campaigns.prepareDraft(
                  context,
                  context.selection.batchId,
                  args,
                )
              : await deps.drafts.create(
                  context.actor.id,
                  context.conversationId,
                  args,
                  stableId(`${context.runId}:${call.id}`),
                );
          context.selection.draftId = draft.id;
          const current = await deps.conversations.get(
            context.actor.id,
            context.conversationId,
          );
          if (current)
            await deps.conversations.setSelection(
              context.actor.id,
              context.conversationId,
              current.version,
              { ...current.selection, draftId: draft.id },
            );
          return {
            ...result(draft),
            receipts: [
              {
                kind: "app_draft",
                id: draft.id,
                href: `/assistant/workspace/${context.conversationId}`,
                verifiedAt: new Date().toISOString(),
              },
            ],
          };
        }
        if (call.name === "update_draft") {
          const draft = await deps.drafts.get(context.actor.id, args.draftId);
          if (
            !draft ||
            draft.conversationId !== context.conversationId ||
            !draft.content.organizationId ||
            !context.selection.organizationIds.includes(
              draft.content.organizationId,
            )
          )
            return blocked("ASSISTANT_DRAFT_NOT_FOUND");
          const approvedTemplates = await deps.db.query(
            "SELECT body_template FROM communication_templates WHERE state='active' AND reviewed_at IS NOT NULL",
          );
          assertApprovedDraftLinks(
            approvedTemplates.rows.map((t) => t.body_template).join("\n"),
            args.html,
          );
          const saved = await deps.drafts.edit(
            context.actor.id,
            draft.id,
            args.revision,
            { subject: args.subject, html: args.html, text: args.text },
          );
          return {
            ...result(saved),
            receipts: [
              {
                kind: "app_draft",
                id: saved.id,
                href: `/assistant/workspace/${context.conversationId}`,
                verifiedAt: new Date().toISOString(),
              },
            ],
          };
        }
        const run = await deps.runs.get(context.actor.id, context.runId);
        if (!run) return blocked("ASSISTANT_RUN_NOT_FOUND");
        const intent: ActionIntent = {
          id: stableId(`${context.runId}:${call.id}`),
          actorId: context.actor.id,
          conversationId: context.conversationId,
          kind: call.name,
          targetId: args.targetId,
          expectedRevision: args.expectedRevision,
          connectionId:
            call.name === "assign_profile_label" ||
            call.name.includes("calendar_event")
              ? await deps.connectionFor(call.name)
              : null,
          arguments: call.name.includes("calendar_event")
            ? args.values
            : validateRecordAction(call.name, args.values),
          sourceMessageId: run.input.sourceMessageId,
        };
        return await deps.executor.execute(context, intent);
      } catch (error) {
        return blocked(
          error instanceof Error && error.message.startsWith("ASSISTANT_")
            ? error.message
            : "ASSISTANT_TOOL_FAILED",
        );
      }
    },
  };
}
