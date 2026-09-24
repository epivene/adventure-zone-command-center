import { GoogleProfileEmailArchiveService } from "../google-workspace/google-profile-email-archive-service";
import type { Pool } from "pg";
import type { MutationAdapter } from "./action-executor";
import type { PostgresGoogleConnectionRepository } from "../google-workspace/google-connection-repository";
import { BusinessDocumentService } from "../business-documents/business-document-service";
import { GoogleReviewProfileAssignmentService } from "../google-workspace/google-review-profile-assignment-service";
import {
  validateTimedEvent,
  calendarEventId,
  type TimedEvent,
} from "./calendar-tools";
import type { RunContext, ActionIntent, ToolResult } from "./contracts";
export function externalAdapters(
  pool: Pool,
  google: PostgresGoogleConnectionRepository,
): Record<string, MutationAdapter> {
  const documents = new BusinessDocumentService();
  async function profile(context: RunContext, id: string) {
    if (
      !context.selection.organizationIds.includes(id) ||
      !(
        await pool.query(
          `SELECT id FROM organizations WHERE id=$1 AND consolidated_into_id IS NULL`,
          [id],
        )
      ).rows[0]
    )
      throw new Error("ASSISTANT_TARGET_NOT_IN_BATCH");
  }
  const receipt = (
    kind: string,
    id: string,
    href: string,
    data: unknown,
  ): ToolResult => ({
    status: "ok",
    data,
    evidence: [],
    receipts: [{ kind, id, href, verifiedAt: new Date().toISOString() }],
    code: null,
  });
  async function calendarAccess(context: RunContext, intent: ActionIntent) {
    const event = intent.arguments as TimedEvent;
    validateTimedEvent(event);
    await profile(context, event.organizationId);
    if (
      event.bookingId &&
      !(
        await pool.query(
          `SELECT id FROM bookings WHERE id=$1 AND organization_id=$2`,
          [event.bookingId, event.organizationId],
        )
      ).rows[0]
    )
      throw new Error("ASSISTANT_BOOKING_MISMATCH");
    const connection = await google.createAssistantCalendarClient();
    if (
      !connection ||
      connection.connectionId !== intent.connectionId ||
      connection.calendarId !== event.calendarId
    )
      throw new Error("ASSISTANT_CALENDAR_CONNECTION_CHANGED");
    return { event, connection };
  }
  const calendar: MutationAdapter = {
    validate: async (c, i) => {
      await calendarAccess(c, i);
    },
    async apply(c, i) {
      const { event, connection } = await calendarAccess(c, i);
      const saved =
        i.kind === "update_calendar_event"
          ? await connection.client.update(
              event,
              i.targetId,
              i.expectedRevision ?? "",
              i.id,
            )
          : await connection.client.create(event, i.id);
      return receipt("calendar_event", saved.id, "/schedule", saved);
    },
    async reconcile(c, i) {
      const { event, connection } = await calendarAccess(c, i);
      const saved = await connection.client.get(
        event.calendarId,
        i.kind === "update_calendar_event" ? i.targetId : calendarEventId(i.id),
      );
      if (
        saved.extendedProperties?.private?.assistantActionId !== i.id ||
        Date.parse(saved.start.dateTime) !== Date.parse(event.startsAt) ||
        Date.parse(saved.end.dateTime) !== Date.parse(event.endsAt) ||
        saved.summary !== event.summary
      )
        throw new Error("ASSISTANT_CALENDAR_READBACK_MISMATCH");
      return receipt("calendar_event", saved.id, "/schedule", saved);
    },
  };
  return {
    create_calendar_event: calendar,
    update_calendar_event: calendar,
    link_document: {
      async validate(c, i) {
        const args = i.arguments as {
          organizationId: string;
          bookingId: string | null;
        };
        await profile(c, args.organizationId);
        const d = await documents.detail(i.targetId);
        if (
          d.lifecycle === "deleted" ||
          d.currentVersionId !== i.expectedRevision
        )
          throw new Error("ASSISTANT_DOCUMENT_VERSION_CONFLICT");
        if (
          args.bookingId &&
          !(
            await pool.query(
              `SELECT id FROM bookings WHERE id=$1 AND organization_id=$2`,
              [args.bookingId, args.organizationId],
            )
          ).rows[0]
        )
          throw new Error("ASSISTANT_BOOKING_MISMATCH");
      },
      async apply(c, i) {
        const args = i.arguments as {
          organizationId: string;
          bookingId: string | null;
        };
        await documents.addLink(
          i.targetId,
          {
            targetKind: "profile",
            targetId: args.organizationId,
            confirmationMode: "manual",
            confidence: null,
            evidence: [{ assistantActionId: i.id }],
          },
          c.actor.id,
        );
        if (args.bookingId)
          await documents.addLink(
            i.targetId,
            {
              targetKind: "booking",
              targetId: args.bookingId,
              confirmationMode: "manual",
              confidence: null,
              evidence: [{ assistantActionId: i.id }],
            },
            c.actor.id,
          );
        const d = await documents.detail(i.targetId);
        if (!d.links.some((l) => l.targetId === args.organizationId))
          throw new Error("ASSISTANT_DOCUMENT_LINK_UNVERIFIED");
        return receipt(
          "document_link",
          d.id,
          `/business-documents?documentId=${d.id}`,
          d,
        );
      },
      async reconcile(c, i) {
        const args = i.arguments as {
          organizationId: string;
          bookingId: string | null;
        };
        await profile(c, args.organizationId);
        const d = await documents.detail(i.targetId);
        if (
          !d.links.some((l) => l.targetId === args.organizationId) ||
          (args.bookingId &&
            !d.links.some((l) => l.targetId === args.bookingId))
        )
          throw new Error("ASSISTANT_DOCUMENT_LINK_UNVERIFIED");
        return receipt(
          "document_link",
          d.id,
          `/business-documents?documentId=${d.id}`,
          d,
        );
      },
    },
    assign_profile_label: {
      async reconcile(c, i) {
        const organizationId = (i.arguments as { organizationId: string })
          .organizationId;
        await profile(c, organizationId);
        if ((await google.getCurrent())?.id !== i.connectionId)
          throw new Error("ASSISTANT_CONNECTION_CHANGED");
        const mutation = (
          await pool.query(
            `SELECT * FROM google_workspace_gmail_mutations WHERE connection_id=$1 AND message_id=$2 ORDER BY created_at DESC LIMIT 1`,
            [i.connectionId, i.targetId],
          )
        ).rows[0];
        if (!mutation || mutation.organization_id !== organizationId)
          throw new Error("ASSISTANT_PROFILE_EMAIL_SYNC_PENDING");
        const gmailSync =
          await new GoogleReviewProfileAssignmentService().retryGmailMutation(
            mutation.id,
          );
        if (gmailSync.state !== "completed")
          return {
            status: "partial",
            data: { gmailSync },
            evidence: [],
            receipts: [],
            code: "ASSISTANT_PROFILE_EMAIL_SYNC_PENDING",
          };
        const archived =
          await new GoogleProfileEmailArchiveService().archiveApprovedThread({
            organizationId,
            contactId: null,
            gmailThreadId: mutation.thread_id,
          });
        if (archived.archiveState !== "complete")
          return {
            status: "partial",
            data: { gmailSync, archiveState: archived.archiveState },
            evidence: [],
            receipts: [],
            code: "ASSISTANT_PROFILE_EMAIL_SYNC_PENDING",
          };
        return receipt(
          "profile_email",
          mutation.thread_id,
          `/profiles/${organizationId}`,
          { gmailSync, archiveState: archived.archiveState },
        );
      },
      async validate(c, i) {
        await profile(
          c,
          (i.arguments as { organizationId: string }).organizationId,
        );
        if ((await google.getCurrent())?.id !== i.connectionId)
          throw new Error("ASSISTANT_CONNECTION_CHANGED");
      },
      async apply(c, i) {
        const client = await google.createReadClient();
        if (!client?.getMessageMetadata)
          throw new Error("ASSISTANT_GMAIL_READ_UNAVAILABLE");
        const m = await client.getMessageMetadata(i.targetId);
        const saved =
          await new GoogleReviewProfileAssignmentService().assignMatched({
            messageId: m.id,
            threadId: m.threadId,
            subject: m.headers.subject,
            from: m.headers.from,
            to: m.headers.to,
            internalDateMs: m.internalDateMs,
            hasAttachments: m.hasAttachments,
            organizationId: (i.arguments as { organizationId: string })
              .organizationId,
            actorId: c.actor.id,
            now: new Date(),
          });
        if (
          saved.gmailSync.state !== "completed" ||
          saved.archiveSync.state !== "complete"
        )
          return {
            status: "partial",
            data: saved,
            evidence: [],
            receipts: [],
            code: "ASSISTANT_PROFILE_EMAIL_SYNC_PENDING",
          };
        return receipt(
          "profile_email",
          m.threadId,
          `/profiles/${saved.organizationId}`,
          saved,
        );
      },
    },
  };
}
