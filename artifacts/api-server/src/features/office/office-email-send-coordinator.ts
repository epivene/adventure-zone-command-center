import type {
  DispatchSafety,
  DispatchClaim,
} from "../outreach-planner/outreach-dispatch";
import type { EarlyBirdPromoService } from "@/features/early-bird-promo/early-bird-promo-service";
import type { MailDelivery } from "./mail-delivery";

type ClaimedOfficeDraft = {
  id: string;
  officeAccountId: string | null;
  organizationId: string;
  contactId: string;
  bookingId: string | null;
  eventYear: number | null;
  recipientEmail: string;
  subject: string;
  body: string;
  templateCode: string | null;
  templateCategory: string | null;
};

type DraftRepository = {
  claimForSend(draftId: string): Promise<ClaimedOfficeDraft>;
  markSent(
    draftId: string,
    input: {
      recipientEmail: string;
      subject: string;
      body: string;
      messageId: string;
      sentAt: Date;
    },
  ): Promise<any>;
  restoreSubmittedAfterFailure(draftId: string, error: string): Promise<void>;
};

export class OfficeEmailSendCoordinator {
  constructor(
    private readonly deps: {
      drafts: DraftRepository;
      delivery: MailDelivery;
      promotion?: Pick<
        EarlyBirdPromoService,
        "prepareBody" | "recordConfirmedSend" | "recordDeposit"
      >;
      dispatchSafety?: DispatchSafety;
      outreachEvents?: { replay(opportunityId?: string): Promise<void> };
      now?: () => Date;
    },
  ) {}

  async send(input: {
    draftId: string;
    overrides: {
      recipientEmail?: string;
      subject?: string;
      body?: string;
    };
  }) {
    const safety = this.deps.dispatchSafety?.enabled()
      ? this.deps.dispatchSafety
      : undefined;
    const recovered = await safety?.recover("office_email", input.draftId);
    const claimed: ClaimedOfficeDraft = recovered
      ? {
          ...recovered.payload,
          recipientEmail: recovered.payload.content.to,
          subject: recovered.payload.content.subject,
          body: recovered.payload.content.body,
          contactId: recovered.payload.contactId!,
        }
      : await this.deps.drafts.claimForSend(input.draftId);
    const recipientEmail = recovered
      ? claimed.recipientEmail
      : (input.overrides.recipientEmail ?? claimed.recipientEmail);
    const subject = recovered
      ? claimed.subject
      : (input.overrides.subject ?? claimed.subject);
    const originalBody = recovered
      ? claimed.body
      : (input.overrides.body ?? claimed.body);
    const sentAt = recovered?.confirmation
      ? new Date(recovered.confirmation.sentAt)
      : (this.deps.now?.() ?? new Date());
    let claim: DispatchClaim | undefined;
    let providerInvoked = false;
    let deliveredKnown = !!recovered;
    try {
      const prepared =
        !recovered && this.deps.promotion && claimed.eventYear
          ? await this.deps.promotion.prepareBody({
              sourceKind: "office_email",
              emailRecordId: claimed.id,
              opportunityId: null,
              organizationId: claimed.organizationId,
              bookingId: claimed.bookingId,
              contactId: claimed.contactId,
              officeAccountId: claimed.officeAccountId,
              eventYear: claimed.eventYear,
              templateCategory: claimed.templateCategory,
              templateCode: claimed.templateCode,
              body: originalBody,
              attemptedAt: sentAt,
            })
          : { body: originalBody, eligible: false, deadlineDate: null };
      const content = { to: recipientEmail, subject, body: prepared.body };
      if (!recovered)
        claim = await safety?.claim("office_email", claimed.id, content);
      providerInvoked = !recovered;
      const delivered =
        recovered?.confirmation ??
        (await this.deps.delivery.send({
          ...content,
          ...(claim
            ? {
                beforeSend: () =>
                  safety!.assertCurrent?.(claim!) ?? Promise.resolve(),
              }
            : {}),
        }));
      deliveredKnown = true;
      if (claim && safety) await safety.finish(claim, { ...delivered, sentAt });
      const draft = await this.deps.drafts.markSent(input.draftId, {
        recipientEmail,
        subject,
        body: prepared.body,
        messageId: delivered.messageId,
        sentAt,
      });
      // Delivery is already durably confirmed. Tracking repair must never reopen it.
      let trackingReviewRequired = false;
      try {
        if (this.deps.promotion && claimed.eventYear) {
          if (claimed.templateCode === "deposit_received") {
            await this.deps.promotion.recordDeposit({
              organizationId: claimed.organizationId,
              eventYear: claimed.eventYear,
              receivedAt: sentAt,
              source: "deposit_received_email",
            });
          } else {
            await this.deps.promotion.recordConfirmedSend({
              sourceKind: "office_email",
              emailRecordId: claimed.id,
              opportunityId: null,
              organizationId: claimed.organizationId,
              bookingId: claimed.bookingId,
              contactId: claimed.contactId,
              officeAccountId: claimed.officeAccountId,
              eventYear: claimed.eventYear,
              templateCategory: claimed.templateCategory,
              templateCode: claimed.templateCode,
              sentAt,
              gmailMessageId: delivered.messageId,
              gmailThreadId: null,
            });
          }
        }
        await this.deps.outreachEvents?.replay(
          recovered?.payload.opportunityId ?? undefined,
        );
      } catch {
        trackingReviewRequired = true;
      }
      if (claim || recovered)
        await safety
          ?.markTracking?.((claim ?? recovered)!, !trackingReviewRequired)
          .catch(() => {
            trackingReviewRequired = true;
          });
      return { ...draft, trackingReviewRequired };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Email delivery failed.";
      let retryable = !providerInvoked;
      if (claim && safety && !deliveredKnown)
        retryable = await safety.fail(claim, error);
      else if (!safety && !deliveredKnown) retryable = true;
      if (!deliveredKnown && retryable)
        await this.deps.drafts
          .restoreSubmittedAfterFailure(input.draftId, message)
          .catch(() => undefined);
      throw error;
    }
  }
}
