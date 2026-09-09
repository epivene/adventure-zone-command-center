import {
  EARLY_BIRD_PROMO,
  earlyBirdPromoDates,
  earlyBirdPromoEligibility,
  removeEarlyBirdPromoBlock,
  upsertEarlyBirdPromoBlock,
} from "./early-bird-promo-policy";
import {
  EarlyBirdPromoRepository,
  type EarlyBirdPromoRecord,
} from "./early-bird-promo-repository";

export type PromoSendContext = {
  sourceKind: "office_email" | "opportunity_email";
  emailRecordId: string;
  opportunityId: string | null;
  organizationId: string;
  bookingId: string | null;
  contactId: string | null;
  officeAccountId: string | null;
  eventYear: number;
  templateCategory: string | null;
  templateCode: string | null;
  body: string;
  attemptedAt: Date;
  alreadyPaid?: boolean;
};

export type PromoConfirmedSend = Omit<PromoSendContext, "body" | "attemptedAt"> & {
  sentAt: Date;
  gmailMessageId: string | null;
  gmailThreadId: string | null;
};

export class EarlyBirdPromoService {
  constructor(private readonly repository: EarlyBirdPromoRepository) {}

  async prepareBody(input: PromoSendContext): Promise<{
    body: string;
    eligible: boolean;
    deadlineDate: string | null;
  }> {
    const existing = await this.repository.getForProfileYear(
      input.organizationId,
      input.eventYear,
    );
    if (existing) {
      const eligible = existing.status === "active"
        && !existing.depositReceivedAt
        && input.attemptedAt < existing.expiresAt
        && earlyBirdPromoEligibility({
          sentAt: input.attemptedAt,
          category: input.templateCategory,
          code: input.templateCode,
          alreadyPaid: input.alreadyPaid ?? false,
        });
      return {
        body: eligible
          ? upsertEarlyBirdPromoBlock(input.body, existing.deadlineDate)
          : removeEarlyBirdPromoBlock(input.body),
        eligible,
        deadlineDate: eligible ? existing.deadlineDate : null,
      };
    }

    const eligible = earlyBirdPromoEligibility({
      sentAt: input.attemptedAt,
      category: input.templateCategory,
      code: input.templateCode,
      alreadyPaid: input.alreadyPaid ?? false,
    });
    const dates = eligible ? earlyBirdPromoDates(input.attemptedAt) : null;
    return {
      body: dates
        ? upsertEarlyBirdPromoBlock(input.body, dates.deadlineDate)
        : removeEarlyBirdPromoBlock(input.body),
      eligible,
      deadlineDate: dates?.deadlineDate ?? null,
    };
  }

  async recordConfirmedSend(
    input: PromoConfirmedSend,
  ): Promise<EarlyBirdPromoRecord | null> {
    if (!earlyBirdPromoEligibility({
      sentAt: input.sentAt,
      category: input.templateCategory,
      code: input.templateCode,
      alreadyPaid: input.alreadyPaid ?? false,
    })) return null;

    const offer = await this.repository.getOfferByCode(EARLY_BIRD_PROMO.offerCode);
    if (
      !offer
      || offer.state !== "active"
      || offer.amountBasisPoints !== 1000
      || offer.deadlineMode !== "days_after_trigger"
      || offer.deadlineDays !== EARLY_BIRD_PROMO.deadlineDays
    ) throw new Error("EARLY_BIRD_PROMO_OFFER_NOT_READY");

    const dates = earlyBirdPromoDates(input.sentAt);
    return this.repository.createFromConfirmedSend({
      commercialOfferRuleId: offer.id,
      opportunityId: input.opportunityId,
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      contactId: input.contactId,
      officeAccountId: input.officeAccountId,
      eventYear: input.eventYear,
      sourceKind: input.sourceKind,
      firstEmailRecordId: input.emailRecordId,
      firstGmailMessageId: input.gmailMessageId,
      firstGmailThreadId: input.gmailThreadId,
      firstSentAt: input.sentAt,
      deadlineDate: dates.deadlineDate,
      expiresAt: dates.expiresAt,
      interestConfirmedAt: null,
      interestEvidenceMessageId: null,
      reminderDueAt: null,
      reminderDraftId: null,
      reminderFollowUpId: null,
      depositReceivedAt: null,
      depositSource: null,
      cancelReason: null,
      claimLeaseOwner: null,
      claimLeaseExpiresAt: null,
    });
  }

  async confirmInterest(input: {
    opportunityId: string;
    confirmedAt: Date;
    evidenceMessageId?: string | null;
  }): Promise<EarlyBirdPromoRecord | null> {
    const record = await this.repository.getForOpportunity(input.opportunityId);
    if (!record || record.status !== "active" || input.confirmedAt >= record.expiresAt) {
      return record;
    }
    if (record.interestConfirmedAt) return record;
    return this.repository.confirmInterest({
      enrollmentId: record.id,
      confirmedAt: input.confirmedAt,
      evidenceMessageId: input.evidenceMessageId ?? null,
      reminderDueAt: earlyBirdPromoDates(record.firstSentAt).reminderDueAt,
    });
  }

  async confirmEnrollmentInterest(input: {
    enrollmentId: string;
    confirmedAt: Date;
    evidenceMessageId?: string | null;
  }): Promise<EarlyBirdPromoRecord | null> {
    const record = await this.repository.getById(input.enrollmentId);
    if (!record || record.status !== "active" || input.confirmedAt >= record.expiresAt) {
      return record;
    }
    if (record.interestConfirmedAt) return record;
    return this.repository.confirmInterest({
      enrollmentId: record.id,
      confirmedAt: input.confirmedAt,
      evidenceMessageId: input.evidenceMessageId ?? null,
      reminderDueAt: earlyBirdPromoDates(record.firstSentAt).reminderDueAt,
    });
  }

  recordDeposit(input: {
    organizationId: string;
    eventYear: number;
    receivedAt: Date;
    source: string;
  }): Promise<EarlyBirdPromoRecord | null> {
    return this.repository.secureWithDeposit(input);
  }

  async recordEnrollmentDeposit(input: {
    enrollmentId: string;
    receivedAt: Date;
    source: string;
  }): Promise<EarlyBirdPromoRecord | null> {
    const record = await this.repository.getById(input.enrollmentId);
    if (!record) return null;
    return this.repository.secureWithDeposit({
      organizationId: record.organizationId,
      eventYear: record.eventYear,
      receivedAt: input.receivedAt,
      source: input.source,
    });
  }

  async cancel(input: {
    enrollmentId: string;
    reason: string;
    cancelledAt: Date;
  }): Promise<EarlyBirdPromoRecord> {
    const record = await this.repository.cancel(input);
    if (!record) throw new Error("EARLY_BIRD_PROMO_NOT_FOUND");
    return record;
  }
}
