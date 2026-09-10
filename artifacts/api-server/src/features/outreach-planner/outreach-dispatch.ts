import { outreachDispatchProtection } from "./outreach-contact-safety";
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  allocationEnabled,
  withAllocationTransaction,
  invalidateAllocationIn,
  type OutreachAllocation,
  type AllocationDatabase,
} from "./outreach-allocation";
import {
  fingerprint,
  loadAllocationFacts,
  type HoldFact,
} from "./outreach-capacity-evidence";
import { OutreachError } from "./outreach-repository";
import { rowsOf, type QueryDatabase } from "./outreach-sources";

export type DraftKind = "opportunity_email" | "office_email";
export type DispatchContent = { to: string; subject: string; body: string };
export type DispatchConfirmation = {
  messageId: string;
  threadId?: string | null;
  sentAt: Date;
};
export type DraftReview = {
  kind: DraftKind;
  id: string;
  organizationId: string;
  contactId: string | null;
  opportunityId: string | null;
  bookingId: string | null;
  // Unassigned Office mail also binds to the profile's known event identities.
  opportunityIdentities?: {
    opportunityId: string;
    bookingId: string;
    eventYear: number;
  }[];
  eventYear: number | null;
  officeAccountId: string | null;
  templateCategory: string | null;
  templateCode: string | null;
  purpose: string | null;
  gmailDraftId: string | null;
  gmailThreadId: string | null;
  revision: number;
  state: string;
  content: DispatchContent;
};
export type DispatchClaim = {
  id: string;
  draft_kind: DraftKind;
  draft_id: string;
  hold_id: string | null;
  state: "dispatching" | "uncertain" | "sent" | "not_sent";
  payload: DraftReview;
  confirmation: {
    messageId: string;
    threadId?: string | null;
    sentAt: string;
  } | null;
  review_after: string;
  verification?: { factsFingerprint: string; validUntil: string };
};
export type DispatchDTO = {
  id: string;
  draftKind: DraftKind;
  draftId: string;
  holdId: string | null;
  state: DispatchClaim["state"];
  intent: "exploratory" | "administrative" | "specific_offer";
  stage: "initial" | "follow_up_1" | "follow_up_2" | null;
  payload: DraftReview;
  confirmation: DispatchClaim["confirmation"];
  reviewAfter: string;
  verification: DispatchClaim["verification"] | null;
  lastError: string | null;
  trackingState: string;
  createdAt: string;
  updatedAt: string;
};
export interface DispatchSafety {
  enabled(): boolean;
  recover(kind: DraftKind, id: string): Promise<DispatchClaim | null>;
  claim(
    kind: DraftKind,
    id: string,
    content: DispatchContent,
  ): Promise<DispatchClaim>;
  assertCurrent?(claim: DispatchClaim): Promise<void>;
  markTracking?(claim: DispatchClaim, complete: boolean): Promise<void>;
  finish(
    claim: DispatchClaim,
    confirmation: DispatchConfirmation,
  ): Promise<void>;
  fail(claim: DispatchClaim, error: unknown): Promise<boolean>;
}
export const draftKindInput = z.enum(["opportunity_email", "office_email"]);
export const dispatchOverridesInput = z
  .object({
    to: z.string().email().max(320).optional(),
    subject: z.string().min(1).max(500).optional(),
    body: z.string().min(1).max(50000).optional(),
  })
  .strict();
export const offerApprovalInput = z
  .object({
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    intent: z.enum(["exploratory", "administrative", "specific_offer"]),
    holdId: z.string().uuid().nullable(),
    stage: z.enum(["initial", "follow_up_1", "follow_up_2"]).nullable(),
    overrides: dispatchOverridesInput.default({}),
    reason: z.string().trim().min(1).max(2000),
  })
  .strict();
const conflict = (message: string) => new OutreachError(409, message);
export function confirmedNoDelivery(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  // Only terminal pre-delivery rejection is retryable. Transport errors and 5xx are uncertain.
  return [
    "GOOGLE_WORKSPACE_NOT_CONNECTED",
    "GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED",
    "GOOGLE_WORKSPACE_OAUTH_TOKEN_REQUEST_FAILED",
    "GOOGLE_WORKSPACE_OAUTH_RESPONSE_INVALID",
    "GOOGLE_WORKSPACE_GMAIL_DRAFT_ID_INVALID",
    "GOOGLE_WORKSPACE_GMAIL_MESSAGE_INVALID",
    "GOOGLE_WORKSPACE_GMAIL_SEND_REJECTED",
    "MAIL_SEND_REJECTED",
    "OUTREACH_SEND_RECHECK_FAILED",
  ].includes(code ?? "");
}
export async function assertNoUnresolvedHoldDispatch(
  tx: QueryDatabase,
  holdId: string,
) {
  const rows = rowsOf(
    await tx.execute(
      sql`select id from outreach_dispatches where hold_id=${holdId}::uuid and state in ('dispatching','uncertain') limit 1`,
    ),
  );
  if (rows.length)
    throw conflict(
      "This hold has an unresolved delivery. Reconcile the provider outcome before changing or converting it.",
    );
}
export async function readDispatchDraft(
  db: QueryDatabase,
  kind: DraftKind,
  id: string,
): Promise<DraftReview> {
  const [r] = rowsOf<any>(
    await db.execute(
      kind === "opportunity_email"
        ? sql`select d.*,o.booking_id,o.organization_id as current_organization_id,o.contact_id as current_contact_id,o.event_year as current_event_year from booking_opportunity_email_state d join booking_opportunities o on o.id=d.opportunity_id where d.id=${id}::uuid`
        : sql`select d.*,t.code as template_code,t.category as template_category,o.id as opportunity_id from office_email_drafts d left join communication_templates t on t.id=d.communication_template_id left join booking_opportunities o on o.organization_id=d.organization_id and o.event_year=d.event_year and (d.booking_id is null or o.booking_id=d.booking_id) where d.id=${id}::uuid`,
    ),
  );
  if (!r) throw new OutreachError(404, "Email draft not found.");
  if (
    kind === "opportunity_email" &&
    (r.organization_id !== r.current_organization_id ||
      r.contact_id !== r.current_contact_id ||
      r.event_year !== r.current_event_year)
  )
    throw conflict(
      "Draft recipient identity or event year changed; recreate the draft from the current opportunity.",
    );
  const opportunityIdentities =
    kind === "office_email" && !r.booking_id
      ? rowsOf<{ opportunityId: string; bookingId: string; eventYear: number }>(
          await db.execute(
            sql`select id as "opportunityId",booking_id as "bookingId",event_year as "eventYear" from booking_opportunities where organization_id=${r.organization_id}::uuid and booking_id is not null and (${r.event_year ?? null}::integer is null or event_year=${r.event_year ?? null}::integer) order by event_year,id`,
          ),
        )
      : [];
  return {
    kind,
    id,
    ...(opportunityIdentities.length ? { opportunityIdentities } : {}),
    organizationId: r.organization_id,
    contactId: r.contact_id,
    opportunityId: r.opportunity_id ?? null,
    bookingId: r.booking_id ?? null,
    eventYear: r.event_year ?? null,
    officeAccountId: r.office_account_id ?? null,
    templateCategory:
      kind === "opportunity_email"
        ? r.purpose === "new_outreach"
          ? "outreach"
          : "follow_up"
        : (r.template_category ?? null),
    templateCode: r.template_code ?? null,
    purpose: r.purpose ?? null,
    gmailDraftId: r.gmail_draft_id ?? null,
    gmailThreadId: r.gmail_thread_id ?? null,
    revision: Number(r.outreach_content_revision),
    state: r.state,
    content: { to: r.recipient_email, subject: r.subject, body: r.body },
  };
}
// State is operational, not content identity. Every persisted content/identity edit
// increments revision even if the owner later restores the old text.
export function dispatchDigest(d: DraftReview) {
  const { state, ...bound } = d;
  return fingerprint(bound);
}
export class OutreachDispatch implements DispatchSafety {
  constructor(
    readonly db: AllocationDatabase,
    readonly allocation: OutreachAllocation,
    readonly prepareBody?: (draft: DraftReview) => Promise<string>,
    readonly enabled = allocationEnabled,
    readonly clock = () => new Date(),
  ) {}
  gate() {
    if (!this.enabled())
      throw new OutreachError(404, "Outreach planner is disabled.");
  }
  async review(kind: DraftKind, id: string, overrides: unknown = {}) {
    this.gate();
    const draft = await readDispatchDraft(this.db, kind, id);
    draft.content = {
      ...draft.content,
      ...dispatchOverridesInput.parse(overrides),
    };
    if (this.prepareBody) draft.content.body = await this.prepareBody(draft);
    const [approval] = rowsOf<any>(
      await this.db.execute(
        sql`select * from outreach_offer_approvals where draft_kind=${kind} and draft_id=${id}::uuid`,
      ),
    );
    const dispatch = await this.lookup(kind, id);
    const reviewReasons: string[] = [];
    const blocked = await outreachDispatchProtection(this.db, {
      ...draft,
      recipientEmail: draft.content.to,
    });
    if (blocked) reviewReasons.push(blocked);
    if (!approval || approval.digest !== dispatchDigest(draft))
      reviewReasons.push(
        "Review intent for this exact final content and recipient.",
      );
    let approvedHold: HoldFact | null = null;
    if (approval?.hold_id) {
      approvedHold =
        rowsOf<HoldFact>(
          await this.db.execute(
            sql`select * from outreach_holds where id=${approval.hold_id}::uuid`,
          ),
        )[0] ?? null;
      try {
        this.validateHold(approvedHold ?? undefined, draft);
        if (approvedHold?.revision !== approval.hold_revision)
          reviewReasons.push(
            "Referenced hold revision changed; review the current hold.",
          );
      } catch (error) {
        reviewReasons.push((error as Error).message);
      }
    }
    return {
      draft,
      digest: dispatchDigest(draft),
      approval: approval ?? null,
      approvedHold,
      approvalCurrent: !reviewReasons.length,
      dispatch,
      reviewReasons,
      requiresIntentReview: !!reviewReasons.length,
    };
  }
  async approve(kind: DraftKind, id: string, body: unknown, actor: string) {
    this.gate();
    const input = offerApprovalInput.parse(body);
    const preview = await this.review(kind, id, input.overrides);
    if (preview.digest !== input.digest)
      throw conflict(
        "Final email content changed. Review the current preview before approving.",
      );
    return withAllocationTransaction(this.db, async (tx) => {
      const current = await readDispatchDraft(tx, kind, id);
      if (
        current.revision !== preview.draft.revision ||
        dispatchDigest({ ...current, content: preview.draft.content }) !==
          preview.digest
      )
        throw conflict(
          "Draft identity changed during review. Refresh the preview.",
        );
      const blocked = await outreachDispatchProtection(tx, {
        ...current,
        recipientEmail: preview.draft.content.to,
      });
      if (blocked) throw conflict(blocked);
      if (["sent", "discarded"].includes(current.state))
        throw conflict("This draft can no longer be approved for delivery.");
      if (await this.lookup(kind, id, tx))
        throw conflict(
          "Resolve the existing delivery before reviewing this draft again.",
        );
      let hold: HoldFact | undefined;
      if (input.intent === "specific_offer") {
        if (!input.holdId)
          throw conflict("Select a live hold for a specific offer.");
        [hold] = rowsOf<HoldFact>(
          await tx.execute(
            sql`select * from outreach_holds where id=${input.holdId}::uuid`,
          ),
        );
        this.validateHold(hold, preview.draft);
      } else if (input.holdId)
        throw conflict("Only a specific offer can reference a hold.");
      if (
        input.stage &&
        (input.intent === "administrative" ||
          current.purpose === "reply" ||
          !current.eventYear ||
          !current.opportunityId)
      )
        throw conflict(
          "Cadence stage requires an explicit event-year outreach opportunity, not a reply or administrative message.",
        );
      const [approval] = rowsOf(
        await tx.execute(
          sql`insert into outreach_offer_approvals(draft_kind,draft_id,digest,intent,hold_id,hold_revision,stage,actor,reason,approved_at) values (${kind},${id}::uuid,${input.digest},${input.intent},${input.holdId}::uuid,${hold?.revision ?? null},${input.stage},${actor},${input.reason},${this.clock()}) on conflict(draft_kind,draft_id) do update set digest=excluded.digest,intent=excluded.intent,hold_id=excluded.hold_id,hold_revision=excluded.hold_revision,stage=excluded.stage,actor=excluded.actor,reason=excluded.reason,approved_at=excluded.approved_at returning *`,
        ),
      );
      await tx.execute(
        sql`insert into outreach_audit(actor,action,entity_id,detail) values (${actor},'approve_email_intent',${id}::uuid,${JSON.stringify(approval)}::jsonb)`,
      );
      return { approval, draft: preview.draft, digest: preview.digest };
    });
  }
  private validateHold(h: HoldFact | undefined, d: DraftReview) {
    if (
      !h ||
      h.state !== "active" ||
      new Date(h.expires_at) <= this.clock() ||
      h.booking_id !== d.bookingId ||
      h.opportunity_id !== d.opportunityId ||
      !d.eventYear ||
      +h.event_starts_on.slice(0, 4) !== d.eventYear
    )
      throw conflict(
        "Specific offer needs a live hold matching this exact booking, opportunity and event year.",
      );
  }
  async lookup(kind: DraftKind, id: string, db: QueryDatabase = this.db) {
    return (
      rowsOf<DispatchClaim>(
        await db.execute(
          sql`select * from outreach_dispatches where draft_kind=${kind} and draft_id=${id}::uuid and state <> 'not_sent' order by created_at desc limit 1`,
        ),
      )[0] ?? null
    );
  }
  async recover(kind: DraftKind, id: string) {
    if (!this.enabled()) return null;
    const claim = await this.lookup(kind, id);
    if (claim && claim.state !== "sent")
      throw conflict(
        "Delivery outcome requires review. Do not resend; check the provider and reconcile this dispatch.",
      );
    return claim;
  }
  async claim(kind: DraftKind, id: string, content: DispatchContent) {
    this.gate();
    const [a] = rowsOf<any>(
      await this.db.execute(
        sql`select * from outreach_offer_approvals where draft_kind=${kind} and draft_id=${id}::uuid`,
      ),
    );
    const hold = a?.hold_id
      ? rowsOf<HoldFact>(
          await this.db.execute(
            sql`select * from outreach_holds where id=${a.hold_id}::uuid`,
          ),
        )[0]
      : undefined;
    const prepared = hold
      ? await this.allocation.prepare(hold.booking_id, {
          ownHoldId: hold.id,
          candidateId: hold.candidate_id,
        })
      : null;
    return withAllocationTransaction(this.db, async (tx) => {
      const draft = await readDispatchDraft(tx, kind, id);
      draft.content = content;
      const blocked = await outreachDispatchProtection(tx, {
        ...draft,
        recipientEmail: content.to,
      });
      if (blocked) throw conflict(blocked);
      if (["sent", "discarded"].includes(draft.state))
        throw conflict("This email has already been sent or discarded.");
      if (await this.lookup(kind, id, tx))
        throw conflict(
          "Delivery is already recorded or requires review; do not resend.",
        );
      const [approval] = rowsOf<any>(
        await tx.execute(
          sql`select * from outreach_offer_approvals where draft_kind=${kind} and draft_id=${id}::uuid`,
        ),
      );
      if (!approval || approval.digest !== dispatchDigest(draft))
        throw conflict(
          "Review explicit intent for the exact final recipient, subject and body before sending.",
        );
      if (approval.intent === "specific_offer") {
        const [current] = rowsOf<HoldFact>(
          await tx.execute(
            sql`select * from outreach_holds where id=${approval.hold_id}::uuid`,
          ),
        );
        this.validateHold(current, draft);
        if (
          current.revision !== approval.hold_revision ||
          !prepared ||
          prepared.ownHoldId !== current.id
        )
          throw conflict(
            "Hold changed since this offer was approved. Review the current hold and final content.",
          );
        // Give the bounded provider call time to complete before the promised expiry.
        if (
          new Date(current.expires_at).getTime() <=
          this.clock().getTime() + 60_000
        )
          throw conflict(
            "Hold expires too soon to dispatch. Extend and review it again.",
          );
        await assertNoUnresolvedHoldDispatch(tx, current.id);
        const check = await this.allocation.evaluateCommitmentIn(tx, prepared);
        if (check.capacity.status !== "fits")
          throw conflict(
            `${check.capacity.status}: ${check.capacity.reasons.join(" ")}`,
          );
      }
      const [claim] = rowsOf<DispatchClaim>(
        await tx.execute(
          sql`insert into outreach_dispatches(draft_kind,draft_id,hold_id,hold_revision,digest,intent,stage,payload,state,review_after) values (${kind},${id}::uuid,${approval.hold_id}::uuid,${approval.hold_revision},${approval.digest},${approval.intent},${approval.stage},${JSON.stringify(draft)}::jsonb,'dispatching',${new Date(this.clock().getTime() + 120_000)}) returning *`,
        ),
      );
      await invalidateAllocationIn(tx);
      const verification = {
        factsFingerprint: fingerprint(await loadAllocationFacts(tx)),
        validUntil:
          prepared?.external?.expiresAt ??
          new Date(this.clock().getTime() + 60_000).toISOString(),
      };
      await tx.execute(
        sql`update outreach_dispatches set verification=${JSON.stringify(verification)}::jsonb where id=${claim.id}::uuid`,
      );
      return { ...claim, verification };
    });
  }
  async assignOfficeIdentity(id: string, body: unknown, actor: string) {
    this.gate();
    const input = z
      .object({
        opportunityId: z.string().uuid(),
        reason: z.string().trim().min(1).max(2000),
      })
      .strict()
      .parse(body);
    return withAllocationTransaction(this.db, async (tx) => {
      const draft = await readDispatchDraft(tx, "office_email", id);
      if (
        !["draft", "submitted", "needs_changes"].includes(draft.state) ||
        (await this.lookup("office_email", id, tx))
      )
        throw conflict(
          "Resolve delivery before changing this draft's identity.",
        );
      const [op] = rowsOf<any>(
        await tx.execute(
          sql`select organization_id,booking_id,event_year from booking_opportunities where id=${input.opportunityId}::uuid`,
        ),
      );
      if (!op || op.organization_id !== draft.organizationId || !op.booking_id)
        throw conflict(
          "Select a canonical opportunity on this profile with an existing booking and event year.",
        );
      await tx.execute(
        sql`update office_email_drafts set booking_id=${op.booking_id}::uuid,event_year=${op.event_year} where id=${id}::uuid`,
      );
      await tx.execute(
        sql`insert into outreach_audit(actor,action,entity_id,detail) values (${actor},'review_email_identity',${id}::uuid,${JSON.stringify(input)}::jsonb)`,
      );
      return readDispatchDraft(tx, "office_email", id);
    });
  }
  async assertCurrent(claim: DispatchClaim) {
    if (!this.enabled()) return;
    try {
      await withAllocationTransaction(this.db, async (tx) => {
        const [current] = rowsOf<DispatchClaim>(
          await tx.execute(
            sql`select * from outreach_dispatches where id=${claim.id}::uuid`,
          ),
        );
        if (
          !current ||
          current.state !== "dispatching" ||
          !current.verification ||
          new Date(current.review_after) <= this.clock() ||
          new Date(current.verification.validUntil) <= this.clock()
        )
          throw conflict(
            "Dispatch verification expired or was reconciled; review before retrying.",
          );
        const draft = await readDispatchDraft(
          tx,
          current.payload.kind,
          current.draft_id,
        );
        if (
          dispatchDigest({ ...draft, content: current.payload.content }) !==
          dispatchDigest(current.payload)
        )
          throw conflict(
            "Draft identity or content was edited while preparing delivery.",
          );
        const blocked = await outreachDispatchProtection(tx, {
          ...current.payload,
          recipientEmail: current.payload.content.to,
        });
        if (blocked) throw conflict(blocked);
        if (current.hold_id) {
          const [h] = rowsOf<HoldFact>(
            await tx.execute(
              sql`select * from outreach_holds where id=${current.hold_id}::uuid`,
            ),
          );
          this.validateHold(h, current.payload);
          if (
            new Date(h.expires_at).getTime() <=
              this.clock().getTime() + 30_000 ||
            fingerprint(await loadAllocationFacts(tx)) !==
              current.verification.factsFingerprint
          )
            throw conflict(
              "Allocation changed or expires before delivery can complete. Recheck the offer.",
            );
        }
      });
    } catch (error) {
      throw Object.assign(error as Error, {
        code: "OUTREACH_SEND_RECHECK_FAILED",
      });
    }
  }
  async finish(claim: DispatchClaim, c: DispatchConfirmation) {
    await withAllocationTransaction(this.db, async (tx) => {
      const [current] = rowsOf<DispatchClaim>(
        await tx.execute(
          sql`select * from outreach_dispatches where id=${claim.id}::uuid`,
        ),
      );
      if (
        !current ||
        !["dispatching", "uncertain", "sent"].includes(current.state)
      )
        throw conflict(
          "Delivery reconciliation changed. Owner review is required.",
        );
      if (
        current.state === "sent" &&
        current.confirmation?.messageId !== c.messageId
      )
        throw conflict(
          "Conflicting provider confirmation; review both messages.",
        );
      await this.persistSentIn(tx, current, c);
    });
  }
  private async persistSentIn(
    tx: QueryDatabase,
    claim: DispatchClaim,
    c: DispatchConfirmation,
  ) {
    const d = claim.payload;
    // Confirmation and actual sent source persist atomically. A later workflow,
    // promotion or planner repair failure cannot authorize another delivery.
    await tx.execute(
      sql`update outreach_dispatches set state='sent',confirmation=${JSON.stringify(c)}::jsonb,updated_at=${this.clock()} where id=${claim.id}::uuid`,
    );
    if (d.kind === "opportunity_email")
      await tx.execute(
        sql`update booking_opportunity_email_state set state='sent',sent_at=${c.sentAt},scheduled_for=null,gmail_message_id=${c.messageId},gmail_thread_id=${c.threadId ?? d.gmailThreadId},recipient_email=${d.content.to},subject=${d.content.subject},body=${d.content.body},last_failure_code=null,last_failure_message=null where id=${d.id}::uuid`,
      );
    else
      await tx.execute(
        sql`update office_email_drafts set state='sent',sent_at=${c.sentAt},sent_message_id=${c.messageId},recipient_email=${d.content.to},subject=${d.content.subject},body=${d.content.body},last_send_error=null where id=${d.id}::uuid`,
      );
    await invalidateAllocationIn(tx);
  }
  async fail(claim: DispatchClaim, error: unknown) {
    const failed = confirmedNoDelivery(error);
    await withAllocationTransaction(this.db, async (tx) => {
      await tx.execute(
        sql`update outreach_dispatches set state=${failed ? "not_sent" : "uncertain"},last_error=${String((error as Error)?.message ?? error).slice(0, 1000)},updated_at=${this.clock()} where id=${claim.id}::uuid and state='dispatching'`,
      );
      await invalidateAllocationIn(tx);
    });
    return failed;
  }
  async markTracking(claim: DispatchClaim, complete: boolean) {
    await withAllocationTransaction(this.db, async (tx) => {
      await tx.execute(
        sql`update outreach_dispatches set tracking_state=${complete ? "complete" : "needs_review"},updated_at=${this.clock()} where id=${claim.id}::uuid and state='sent'`,
      );
    });
  }
  async list(): Promise<DispatchDTO[]> {
    this.gate();
    const rows = rowsOf<any>(
      await this.db.execute(
        sql`select * from outreach_dispatches order by created_at desc limit 200`,
      ),
    );
    return rows.map((row) => ({
      id: row.id,
      draftKind: row.draft_kind,
      draftId: row.draft_id,
      holdId: row.hold_id,
      state: row.state,
      intent: row.intent,
      stage: row.stage,
      payload: row.payload,
      confirmation: row.confirmation,
      reviewAfter: new Date(row.review_after).toISOString(),
      verification: row.verification ?? null,
      lastError: row.last_error,
      trackingState: row.tracking_state,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    }));
  }
  async reconcile(id: string, body: unknown, actor: string) {
    this.gate();
    const input = z
      .object({
        outcome: z.enum(["sent", "not_sent"]),
        sourceReference: z.string().trim().min(1).max(2000),
        reason: z.string().trim().min(1).max(2000),
        messageId: z.string().trim().min(1).optional(),
        sentAt: z.string().datetime({ offset: true }).optional(),
        threadId: z.string().nullable().optional(),
        providerOperationTerminated: z.literal(true),
      })
      .strict()
      .parse(body);
    if (
      input.outcome === "sent" &&
      (!input.messageId ||
        !input.sentAt ||
        new Date(input.sentAt) > this.clock())
    )
      throw conflict(
        "Confirmed delivery needs an actual provider message ID and past sent time.",
      );
    return withAllocationTransaction(this.db, async (tx) => {
      const [claim] = rowsOf<DispatchClaim>(
        await tx.execute(
          sql`select * from outreach_dispatches where id=${id}::uuid`,
        ),
      );
      if (!claim) throw new OutreachError(404, "Dispatch not found.");
      if (
        !["dispatching", "uncertain"].includes(claim.state) ||
        new Date(claim.review_after) > this.clock()
      )
        throw conflict(
          "Only an unresolved dispatch after its provider operation has ended can be reconciled.",
        );
      if (input.outcome === "sent")
        await this.persistSentIn(tx, claim, {
          messageId: input.messageId!,
          sentAt: new Date(input.sentAt!),
          threadId: input.threadId,
        });
      else {
        await tx.execute(
          sql`update outreach_dispatches set state='not_sent',updated_at=${this.clock()} where id=${id}::uuid`,
        );
        if (claim.payload.kind === "office_email")
          await tx.execute(
            sql`update office_email_drafts set state='submitted',last_send_error='Owner verified no delivery; review before retry.' where id=${claim.draft_id}::uuid and state='sending'`,
          );
        await invalidateAllocationIn(tx);
      }
      await tx.execute(
        sql`insert into outreach_audit(actor,action,entity_id,detail) values (${actor},'reconcile_email_delivery',${id}::uuid,${JSON.stringify(input)}::jsonb)`,
      );
      return { id, state: input.outcome };
    });
  }
}
