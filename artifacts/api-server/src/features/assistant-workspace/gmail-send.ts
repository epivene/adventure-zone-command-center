import { captureSendSources } from "./send-sources";
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type { db as Database } from "@workspace/db";
import type { DraftStore, WorkspaceDraft } from "./draft-store";
import type { ConversationStore } from "./conversation-store";
import type { PostgresGoogleConnectionRepository } from "../google-workspace/google-connection-repository";
import {
  OutreachDispatch,
  type DispatchClaim,
} from "../outreach-planner/outreach-dispatch";
import { createProductionOutreachAllocation } from "../outreach-planner/production-outreach-allocation";
import { outreachDispatchProtection } from "../outreach-planner/outreach-contact-safety";
import { EarlyBirdPromoService } from "../early-bird-promo/early-bird-promo-service";
import { EarlyBirdPromoRepository } from "../early-bird-promo/early-bird-promo-repository";
import { removeEarlyBirdPromoBlock } from "../early-bird-promo/early-bird-promo-policy";
import { GoogleReviewProfileAssignmentService } from "../google-workspace/google-review-profile-assignment-service";
import { assertSendRevision } from "./send-tools";
import { assertMimeReadback } from "./gmail-drafts";
import type { MutationAdapter } from "./action-executor";
import type { RunContext, ActionIntent, ToolResult } from "./contracts";
export type PaymentModel = "prepaid" | "pay_per_play" | "administrative";
export function createWorkspaceSendService(deps: {
  pool: Pool;
  db: typeof Database;
  drafts: DraftStore;
  conversations: ConversationStore;
  google: PostgresGoogleConnectionRepository;
  dispatchFactory?: (payment: PaymentModel) => OutreachDispatch;
  protectContact?: typeof outreachDispatchProtection;
  captureSources?: (draft: WorkspaceDraft) => Promise<string>;
  syncSent?: (input: {
    messageId: string;
    threadId: string;
    organizationId: string;
    actorId: string;
    sentAt: Date;
  }) => Promise<boolean>;
}) {
  const { pool, db, drafts, conversations, google } = deps;
  const promotion = new EarlyBirdPromoService(new EarlyBirdPromoRepository(db));
  const capture = async (draft: WorkspaceDraft) =>
    deps.captureSources
      ? deps.captureSources(draft)
      : captureSendSources(
          pool,
          (await google.createReadClient()) ?? {},
          draft,
        );
  const hash = (s: string) => createHash("sha256").update(s).digest("hex");
  async function owned(actor: string, id: string, revision: string) {
    const draft = await drafts.get(actor, id);
    if (!draft) throw new Error("ASSISTANT_DRAFT_NOT_FOUND");
    assertSendRevision(revision, draft.revision);
    if (!draft.content.organizationId)
      throw new Error("ASSISTANT_PROFILE_REQUIRED");
    return draft;
  }
  async function reviewRecord(actor: string, id: string) {
    const r = await pool.query(
      `SELECT * FROM assistant_workspace_send_reviews WHERE actor_id=$1 AND draft_id=$2`,
      [actor, id],
    );
    if (!r.rows[0]) throw new Error("ASSISTANT_SEND_REVIEW_REQUIRED");
    return r.rows[0];
  }
  function dispatch(paymentModel: PaymentModel) {
    if (deps.dispatchFactory) return deps.dispatchFactory(paymentModel);
    return new OutreachDispatch(
      db,
      createProductionOutreachAllocation(db),
      async (d) => {
        if (paymentModel !== "prepaid")
          return removeEarlyBirdPromoBlock(d.content.body);
        if (!d.eventYear) throw new Error("ASSISTANT_EVENT_YEAR_REQUIRED");
        return (
          await promotion.prepareBody({
            sourceKind: "office_email",
            emailRecordId: d.id,
            opportunityId: d.opportunityId,
            organizationId: d.organizationId,
            bookingId: d.bookingId,
            contactId: d.contactId,
            officeAccountId: null,
            eventYear: d.eventYear,
            templateCategory: d.templateCategory,
            templateCode: d.templateCode,
            body: d.content.body,
            attemptedAt: new Date(),
          })
        ).body;
      },
    );
  }
  async function review(
    actor: string,
    id: string,
    revision: string,
    paymentModel: PaymentModel,
  ) {
    const draft = await owned(actor, id, revision);
    if (draft.status !== "saved" || !draft.gmailDraftId || !draft.connectionId)
      throw new Error("ASSISTANT_SAVE_GMAIL_FIRST");
    const current = await google.getCurrent();
    if (current?.id !== draft.connectionId)
      throw new Error("ASSISTANT_CONNECTION_CHANGED");
    const client = await google.createReadClient();
    if (!client?.getGmailDraftRaw)
      throw new Error("ASSISTANT_GMAIL_READBACK_UNAVAILABLE");
    const gmail = await client.getGmailDraftRaw(draft.gmailDraftId);
    if (hash(gmail.raw) !== draft.gmailHash)
      throw new Error("ASSISTANT_GMAIL_DRAFT_CHANGED");
    const c = await conversations.get(actor, draft.conversationId);
    if (!c || !draft.content.eventYear)
      throw new Error("ASSISTANT_EVENT_YEAR_REQUIRED");
    const contacts = (
      await pool.query(
        `SELECT c.id FROM contacts c JOIN organization_contacts oc ON oc.contact_id=c.id WHERE oc.organization_id=$1 AND oc.active=true AND lower(c.email)=lower($2)`,
        [draft.content.organizationId, draft.content.to[0]],
      )
    ).rows;
    if (contacts.length !== 1)
      throw new Error("ASSISTANT_RECIPIENT_REVIEW_REQUIRED");
    if (
      draft.content.bookingId &&
      !(
        await pool.query(
          `SELECT id FROM bookings WHERE id=$1 AND organization_id=$2`,
          [draft.content.bookingId ?? null, draft.content.organizationId],
        )
      ).rows[0]
    )
      throw new Error("ASSISTANT_BOOKING_MISMATCH");
    const snapshot = {
      sources: await capture(draft),
      organizationId: draft.content.organizationId,
      contactId: contacts[0].id,
      bookingId: draft.content.bookingId ?? null,
      eventYear: draft.content.eventYear,
      recipientEmail: draft.content.to[0],
      subject: draft.content.subject,
      body: draft.content.html,
    };
    const connection = await pool.connect();
    try {
      await connection.query("BEGIN");
      await connection.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,
        [draft.id],
      );
      const existing = (
        await connection.query(
          `SELECT * FROM office_email_drafts WHERE id=$1 FOR UPDATE`,
          [draft.id],
        )
      ).rows[0];
      const prior = (
        await connection.query(
          `SELECT * FROM assistant_workspace_send_reviews WHERE draft_id=$1 AND actor_id=$2`,
          [draft.id, actor],
        )
      ).rows[0];
      if (existing) {
        if (
          !prior ||
          ["sent", "sending", "scheduled"].includes(existing.state) ||
          (
            await connection.query(
              `SELECT id FROM outreach_dispatches WHERE draft_kind='office_email' AND draft_id=$1 AND state IN ('dispatching','uncertain','sent')`,
              [draft.id],
            )
          ).rows.length
        )
          throw new Error("ASSISTANT_SEND_STATE_CONFLICT");
        const p = prior.office_snapshot;
        if (
          existing.subject !== p.subject ||
          existing.body !== p.body ||
          existing.recipient_email !== p.recipientEmail ||
          existing.organization_id !== p.organizationId ||
          existing.contact_id !== p.contactId ||
          existing.booking_id !== p.bookingId ||
          existing.event_year !== p.eventYear
        )
          throw new Error("ASSISTANT_OFFICE_DRAFT_CHANGED");
        await connection.query(
          `UPDATE office_email_drafts SET organization_id=$2,contact_id=$3,booking_id=$4,event_year=$5,recipient_email=$6,subject=$7,body=$8,communication_template_id=$9,gmail_draft_id=$10,gmail_thread_id=$11,state='draft',updated_at=now() WHERE id=$1`,
          [
            draft.id,
            snapshot.organizationId,
            snapshot.contactId,
            snapshot.bookingId,
            snapshot.eventYear,
            snapshot.recipientEmail,
            snapshot.subject,
            snapshot.body,
            draft.content.templateId,
            draft.gmailDraftId,
            gmail.threadId,
          ],
        );
      } else
        await connection.query(
          `INSERT INTO office_email_drafts(id,organization_id,contact_id,booking_id,event_year,recipient_email,subject,body,body_format,communication_template_id,gmail_draft_id,gmail_thread_id,coordinator_note) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'html',$9,$10,$11,$12)`,
          [
            draft.id,
            snapshot.organizationId,
            snapshot.contactId,
            snapshot.bookingId,
            snapshot.eventYear,
            snapshot.recipientEmail,
            snapshot.subject,
            snapshot.body,
            draft.content.templateId,
            draft.gmailDraftId,
            gmail.threadId,
            `Assistant workspace draft ${draft.id}`,
          ],
        );
      await connection.query(
        `INSERT INTO assistant_workspace_send_reviews(draft_id,actor_id,revision,office_snapshot,raw,connection_id,payment_model) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7) ON CONFLICT(draft_id) DO UPDATE SET revision=excluded.revision,office_snapshot=excluded.office_snapshot,raw=excluded.raw,connection_id=excluded.connection_id,payment_model=excluded.payment_model,approved_revision=NULL,approved_by=NULL,approved_at=NULL,updated_at=now()`,
        [
          draft.id,
          actor,
          revision,
          JSON.stringify(snapshot),
          gmail.raw,
          draft.connectionId,
          paymentModel,
        ],
      );
      await connection.query("COMMIT");
    } catch (error) {
      await connection.query("ROLLBACK");
      throw error;
    } finally {
      connection.release();
    }
    const reviewed = await dispatch(paymentModel).review(
      "office_email",
      draft.id,
    );
    if (reviewed.draft.content.body !== draft.content.html)
      return {
        status: "revision_required",
        revision,
        digest: null,
        html: reviewed.draft.content.body,
        reviewReasons: [
          "Promotion wording or timing changed. Apply it as a new draft revision, save in Gmail, and review again.",
        ],
      };
    return {
      status: "ready",
      revision,
      digest: reviewed.digest,
      html: draft.content.html,
      reviewReasons: reviewed.reviewReasons,
      approvedHold: reviewed.approvedHold,
    };
  }
  async function approve(
    actor: string,
    id: string,
    revision: string,
    input: {
      digest: string;
      intent: "exploratory" | "administrative" | "specific_offer";
      holdId: string | null;
      stage: "initial" | "follow_up_1" | "follow_up_2" | null;
      reason: string;
      evidenceReviewed: boolean;
    },
  ) {
    if (!input.evidenceReviewed)
      throw new Error("ASSISTANT_SOURCE_REVIEW_REQUIRED");
    await owned(actor, id, revision);
    const r = await reviewRecord(actor, id);
    assertSendRevision(revision, r.revision);
    const draft = await owned(actor, id, revision);
    if (r.office_snapshot.sources !== (await capture(draft)))
      throw new Error("ASSISTANT_SOURCES_CHANGED");
    const { evidenceReviewed: _, ...approval } = input;
    await dispatch(r.payment_model).approve(
      "office_email",
      id,
      { ...approval, overrides: {} },
      actor,
    );
    await pool.query(
      `UPDATE assistant_workspace_send_reviews SET approved_revision=$3,approved_by=$1,approved_at=now() WHERE actor_id=$1 AND draft_id=$2 AND revision=$3`,
      [actor, id, revision],
    );
    return { approved: true, revision };
  }
  async function boundary(
    context: RunContext,
    intent: ActionIntent,
    checkGmail = true,
  ) {
    const draft = await owned(
      context.actor.id,
      intent.targetId,
      intent.expectedRevision ?? "",
    );
    const r = await reviewRecord(context.actor.id, draft.id);
    assertSendRevision(draft.revision, r.approved_revision);
    if (
      r.approved_by !== context.actor.id ||
      r.connection_id !== intent.connectionId ||
      (await google.getCurrent())?.id !== intent.connectionId
    )
      throw new Error("ASSISTANT_CONNECTION_CHANGED");
    if (context.signal.aborted) throw new Error("ASSISTANT_CANCELLED");
    for (const email of checkGmail
      ? [...draft.content.to, ...draft.content.cc]
      : []) {
      const contacts = (
        await pool.query(
          `SELECT c.id FROM contacts c JOIN organization_contacts oc ON oc.contact_id=c.id WHERE oc.organization_id=$1 AND oc.active=true AND lower(c.email)=lower($2)`,
          [draft.content.organizationId, email],
        )
      ).rows;
      if (contacts.length !== 1) throw new Error("ASSISTANT_RECIPIENT_CHANGED");
      const blocked = await (deps.protectContact ?? outreachDispatchProtection)(
        db,
        {
          organizationId: draft.content.organizationId!,
          contactId: contacts[0].id,
          recipientEmail: email,
          eventYear: r.office_snapshot.eventYear,
        },
      );
      if (blocked) throw new Error("ASSISTANT_CONTACT_BLOCKED");
    }
    const client = await google.createReadClient();
    if (!client?.getGmailDraftRaw)
      throw new Error("ASSISTANT_GMAIL_READBACK_UNAVAILABLE");
    if (checkGmail) {
      if (
        !r.office_snapshot.sources ||
        r.office_snapshot.sources !== (await capture(draft))
      )
        throw new Error("ASSISTANT_SOURCES_CHANGED");
      if (!["saved", "sending"].includes(draft.status) || !draft.gmailDraftId)
        throw new Error("ASSISTANT_SAVE_GMAIL_FIRST");
      const actual = await client.getGmailDraftRaw(draft.gmailDraftId);
      if (hash(actual.raw) !== draft.gmailHash)
        throw new Error("ASSISTANT_GMAIL_DRAFT_CHANGED");
      assertMimeReadback(r.raw, actual.raw);
    }
    return { draft, r, client, safety: dispatch(r.payment_model) };
  }
  async function tracked(
    context: RunContext,
    draft: WorkspaceDraft,
    r: any,
    claim: DispatchClaim,
    messageId: string,
    threadId: string,
    sentAt: Date,
  ): Promise<ToolResult> {
    let trackingComplete = false;
    try {
      if (r.payment_model === "prepaid")
        await promotion.recordConfirmedSend({
          sourceKind: "office_email",
          emailRecordId: draft.id,
          opportunityId: claim.payload.opportunityId,
          organizationId: claim.payload.organizationId,
          bookingId: claim.payload.bookingId,
          contactId: claim.payload.contactId,
          officeAccountId: null,
          eventYear: claim.payload.eventYear!,
          templateCategory: claim.payload.templateCategory,
          templateCode: claim.payload.templateCode,
          sentAt,
          gmailMessageId: messageId,
          gmailThreadId: threadId,
        });
      if (deps.syncSent) {
        trackingComplete = await deps.syncSent({
          messageId,
          threadId,
          organizationId: claim.payload.organizationId,
          actorId: context.actor.id,
          sentAt,
        });
      } else {
        const client = await google.createReadClient();
        if (!client?.getMessageMetadata)
          throw new Error("ASSISTANT_GMAIL_READBACK_UNAVAILABLE");
        const m = await client.getMessageMetadata(messageId);
        const synced =
          await new GoogleReviewProfileAssignmentService().assignMatched({
            messageId,
            threadId,
            subject: m.headers.subject,
            from: m.headers.from,
            to: m.headers.to,
            internalDateMs: m.internalDateMs,
            hasAttachments: m.hasAttachments,
            organizationId: claim.payload.organizationId,
            actorId: context.actor.id,
            now: sentAt,
          });
        trackingComplete =
          synced.gmailSync.state === "completed" &&
          synced.archiveSync.state === "complete";
      }
    } catch {
      /* Confirmed delivery remains final. */
    }
    await dispatch(r.payment_model)
      .markTracking(claim, trackingComplete)
      .catch(() => {});
    await pool.query(
      `UPDATE assistant_workspace_send_reviews SET tracking_complete=$3 WHERE draft_id=$1 AND actor_id=$2`,
      [draft.id, context.actor.id, trackingComplete],
    );
    return {
      status: "ok",
      data: {
        delivery: "sent",
        tracking: trackingComplete ? "complete" : "needs_repair",
        messageId,
        threadId,
        sentAt: sentAt.toISOString(),
      },
      evidence: [],
      receipts: [
        {
          kind: "sent_email",
          id: messageId,
          href: `/profiles/${draft.content.organizationId}`,
          verifiedAt: new Date().toISOString(),
        },
      ],
      code: trackingComplete ? null : "ASSISTANT_TRACKING_REPAIR_REQUIRED",
    };
  }
  const adapter: MutationAdapter = {
    async validate(c, i) {
      const { draft, safety } = await boundary(c, i);
      const review = await safety.review("office_email", draft.id);
      if (
        !review.approvalCurrent ||
        review.draft.content.body !== draft.content.html
      )
        throw new Error("ASSISTANT_SEND_REVIEW_REQUIRED");
    },
    async apply(c, i) {
      const { draft, r, client, safety } = await boundary(c, i);
      await drafts.claimSend(c.actor.id, draft.id, draft.revision);
      const claim = await safety.claim("office_email", draft.id, {
        to: draft.content.to[0],
        subject: draft.content.subject,
        body: draft.content.html,
      });
      try {
        const delivery = await google.createGmailDeliveryClient();
        if (delivery?.connectionId !== i.connectionId)
          throw new Error("ASSISTANT_CONNECTION_CHANGED");
        const sent = await delivery.client.sendGmailDraft({
          draftId: draft.gmailDraftId!,
          raw: r.raw,
          threadId: draft.content.threadId,
          beforeSend: async () => {
            await boundary(c, i);
            await safety.assertCurrent(claim);
          },
        });
        if (
          !sent.threadId ||
          !client.getGmailMessageRaw ||
          !client.getMessageMetadata
        )
          throw new Error("ASSISTANT_SEND_UNCERTAIN");
        const readback = await client.getGmailMessageRaw(sent.messageId);
        if (!readback.labelIds.includes("SENT"))
          throw new Error("ASSISTANT_SEND_UNCERTAIN");
        assertMimeReadback(r.raw, readback.raw);
        const metadata = await client.getMessageMetadata(sent.messageId);
        if (!metadata.internalDateMs)
          throw new Error("ASSISTANT_SEND_TIME_UNVERIFIED");
        const sentAt = new Date(metadata.internalDateMs);
        await safety.finish(claim, {
          messageId: sent.messageId,
          threadId: sent.threadId,
          sentAt,
        });
        await drafts.mark(c.actor.id, draft.id, draft.revision, "sent");
        return tracked(
          c,
          draft,
          r,
          claim,
          sent.messageId,
          sent.threadId,
          sentAt,
        );
      } catch (error) {
        if (
          (error as { code?: string })?.code === "OUTREACH_SEND_RECHECK_FAILED"
        ) {
          await safety.fail(claim, error);
          await pool.query(
            `UPDATE assistant_workspace_send_reviews SET approved_revision=NULL,approved_by=NULL,approved_at=NULL WHERE draft_id=$1 AND actor_id=$2`,
            [draft.id, c.actor.id],
          );
          await drafts.restoreUnsent(c.actor.id, draft.id, draft.revision);
          return {
            status: "blocked",
            data: { delivery: "not_sent", draftId: draft.id },
            evidence: [],
            receipts: [],
            code: "ASSISTANT_SEND_NOT_DISPATCHED",
          };
        }
        await drafts
          .mark(c.actor.id, draft.id, draft.revision, "uncertain")
          .catch(() => {});
        await safety.fail(claim, error).catch(() => {});
        throw error;
      }
    },
    async reconcile(c, i) {
      const { draft, r, client, safety } = await boundary(c, i, false);
      const claim = (
        await pool.query(
          `SELECT * FROM outreach_dispatches WHERE draft_kind='office_email' AND draft_id=$1 ORDER BY created_at DESC LIMIT 1`,
          [draft.id],
        )
      ).rows[0] as DispatchClaim | undefined;
      if (!claim) throw new Error("ASSISTANT_SEND_UNCERTAIN");
      let confirmed = claim.confirmation;
      if (!confirmed) {
        if (
          !client.listMessagePage ||
          !client.getGmailMessageRaw ||
          !client.getMessageMetadata
        )
          throw new Error("ASSISTANT_GMAIL_READBACK_UNAVAILABLE");
        const page = await client.listMessagePage({
          maxResults: 25,
          query: `in:sent rfc822msgid:${draft.messageId.replace(/[<>]/g, "")}`,
        });
        if (page.nextPageToken || page.messages.length !== 1)
          throw new Error("ASSISTANT_SEND_UNCERTAIN");
        const m = await client.getGmailMessageRaw(page.messages[0].id);
        if (!m.labelIds.includes("SENT"))
          throw new Error("ASSISTANT_SEND_UNCERTAIN");
        assertMimeReadback(r.raw, m.raw);
        const metadata = await client.getMessageMetadata(m.messageId);
        if (!metadata.internalDateMs)
          throw new Error("ASSISTANT_SEND_TIME_UNVERIFIED");
        confirmed = {
          messageId: m.messageId,
          threadId: m.threadId,
          sentAt: new Date(metadata.internalDateMs).toISOString(),
        };
        await safety.finish(claim, {
          ...confirmed,
          sentAt: new Date(confirmed.sentAt),
        });
      }
      if (!confirmed.threadId) throw new Error("ASSISTANT_SEND_UNCERTAIN");
      await drafts.mark(c.actor.id, draft.id, draft.revision, "sent");
      return tracked(
        c,
        draft,
        r,
        claim,
        confirmed.messageId,
        confirmed.threadId,
        new Date(confirmed.sentAt),
      );
    },
  };
  return { review, approve, adapter };
}
