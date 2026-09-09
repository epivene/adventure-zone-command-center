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
  markSent(draftId: string, input: {
    recipientEmail: string;
    subject: string;
    body: string;
    messageId: string;
    sentAt: Date;
  }): Promise<any>;
  restoreSubmittedAfterFailure(draftId: string, error: string): Promise<void>;
};

export class OfficeEmailSendCoordinator {
  constructor(private readonly deps: {
    drafts: DraftRepository;
    delivery: MailDelivery;
    promotion?: Pick<EarlyBirdPromoService, "prepareBody" | "recordConfirmedSend" | "recordDeposit">;
    now?: () => Date;
  }) {}

  async send(input: {
    draftId: string;
    overrides: {
      recipientEmail?: string;
      subject?: string;
      body?: string;
    };
  }) {
    const claimed = await this.deps.drafts.claimForSend(input.draftId);
    const recipientEmail = input.overrides.recipientEmail ?? claimed.recipientEmail;
    const subject = input.overrides.subject ?? claimed.subject;
    const originalBody = input.overrides.body ?? claimed.body;
    const sentAt = this.deps.now?.() ?? new Date();

    try {
      const prepared = this.deps.promotion && claimed.eventYear
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
      const delivered = await this.deps.delivery.send({
        to: recipientEmail,
        subject,
        body: prepared.body,
      });
      const draft = await this.deps.drafts.markSent(input.draftId, {
        recipientEmail,
        subject,
        body: prepared.body,
        messageId: delivered.messageId,
        sentAt,
      });
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
      return draft;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Email delivery failed.";
      await this.deps.drafts
        .restoreSubmittedAfterFailure(input.draftId, message)
        .catch(() => undefined);
      throw error;
    }
  }
}
