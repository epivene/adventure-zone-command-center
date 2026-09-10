import type {
  DispatchSafety,
  DispatchContent,
  DispatchClaim,
} from "../outreach-planner/outreach-dispatch";
import type { DraftGenerator } from "./draft-generator";
import type { EarlyBirdPromoService } from "@/features/early-bird-promo/early-bird-promo-service";
import { evaluateDraftGuardrails, type DraftBlocker } from "./draft-guardrails";
import type { DraftContext } from "./draft-context-resolver";
import type {
  CreateOpportunityEmailInput,
  OpportunityDraftPurpose,
  OpportunityEmailRecord,
  UpdateOpportunityEmailInput,
} from "./opportunity-email-types";

export type DraftRewriteAction =
  | "shorter"
  | "more_casual"
  | "more_direct"
  | "rewrite_opening"
  | "more_personal"
  | "stronger_follow_up"
  | "fix_wording";

export type CreateOpportunityDraftResult =
  | { ok: true; draft: OpportunityEmailRecord }
  | { ok: false; blocker: DraftBlocker };

export type OpportunityEmailRepositoryPort = {
  getCurrentForOpportunity(
    opportunityId: string,
  ): Promise<OpportunityEmailRecord | null>;
  getById(id: string): Promise<OpportunityEmailRecord | null>;
  create(input: CreateOpportunityEmailInput): Promise<OpportunityEmailRecord>;
  update(
    id: string,
    patch: UpdateOpportunityEmailInput,
  ): Promise<OpportunityEmailRecord>;
  findBySendRequestKey?(
    requestKey: string,
  ): Promise<OpportunityEmailRecord | null>;
  findByScheduleRequestKey?(
    requestKey: string,
  ): Promise<OpportunityEmailRecord | null>;
};

export type ConfirmedSend = {
  messageId: string;
  threadId?: string | null;
  sentAt: Date;
};

export type GmailDraftProvider = {
  createDraft(input: { to: string; subject: string; body: string }): Promise<{
    draftId: string;
    messageId: string;
    threadId?: string | null;
  }>;
  updateDraft(input: {
    draftId: string;
    to: string;
    subject: string;
    body: string;
  }): Promise<{
    draftId: string;
    messageId: string;
    threadId?: string | null;
  }>;
  sendDraft?(input: {
    draftId: string;
    content?: DispatchContent;
    threadId?: string | null;
    beforeSend?: () => Promise<void>;
  }): Promise<ConfirmedSend>;
  reconcileSend?(input: {
    draftId: string;
    messageId: string;
  }): Promise<ConfirmedSend | null>;
};

export type OpportunityDraftBlockerSink = {
  record(input: {
    opportunityId: string;
    blocker: DraftBlocker;
  }): Promise<void>;
};

export type DraftRewriteAdapter = {
  rewrite(input: {
    opportunityId: string;
    draftId: string;
    purpose: OpportunityDraftPurpose;
    action: DraftRewriteAction;
    subject: string;
    body: string;
  }): Promise<{ subject: string; body: string }>;
};

export type OpportunityEmailWorkflowSink = {
  recordDraftCreated?(input: {
    opportunityId: string;
    draftId: string;
  }): Promise<void>;
  recordDraftUpdated?(input: {
    opportunityId: string;
    draftId: string;
  }): Promise<void>;
  recordSent(input: {
    opportunityId: string;
    draftId: string;
    sentAt: Date;
    messageId: string;
    threadId: string | null;
  }): Promise<void>;
  recordScheduled(input: {
    opportunityId: string;
    draftId: string;
    scheduledFor: Date;
  }): Promise<void>;
  recordFailure(input: {
    opportunityId: string;
    draftId: string;
    operation: "send" | "schedule";
    code: string;
    message: string;
  }): Promise<void>;
};

export type OpportunityEmailServiceDependencies = {
  contextResolver: { resolve(opportunityId: string): Promise<DraftContext> };
  emailRepository: OpportunityEmailRepositoryPort;
  draftGenerator: DraftGenerator;
  gmailDraftProvider: GmailDraftProvider;
  blockerSink: OpportunityDraftBlockerSink;
  rewriteAdapter?: DraftRewriteAdapter;
  workflowSink?: OpportunityEmailWorkflowSink;
  promotion?: Pick<
    EarlyBirdPromoService,
    "prepareBody" | "recordConfirmedSend"
  >;
  dispatchSafety?: DispatchSafety;
  outreachEvents?: { replay(opportunityId: string): Promise<void> };
  now?: () => Date;
};

function serviceError(code: string): Error {
  return Object.assign(new Error(code), { code });
}
function errorCode(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  )
    return (error as { code: string }).code;
  if (error instanceof Error && error.message) return error.message;
  return "OPPORTUNITY_EMAIL_DELIVERY_FAILED";
}
function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : errorCode(error);
}

export class OpportunityEmailService {
  constructor(private readonly deps: OpportunityEmailServiceDependencies) {}

  async createDraft(input: {
    opportunityId: string;
    purpose: OpportunityDraftPurpose;
  }): Promise<CreateOpportunityDraftResult> {
    const context = await this.deps.contextResolver.resolve(
      input.opportunityId,
    );
    const guardrail = evaluateDraftGuardrails(context, input.purpose);
    if (guardrail.blocker) {
      await this.deps.blockerSink.record({
        opportunityId: input.opportunityId,
        blocker: guardrail.blocker,
      });
      return { ok: false, blocker: guardrail.blocker };
    }
    const existing = await this.deps.emailRepository.getCurrentForOpportunity(
      input.opportunityId,
    );
    if (existing) return { ok: true, draft: existing };
    const generated = await this.deps.draftGenerator.generate({
      context,
      purpose: guardrail.effectivePurpose,
      existingBody: null,
    });
    const gmail = await this.deps.gmailDraftProvider.createDraft({
      to: context.recipientEmail!,
      subject: generated.subject,
      body: generated.body,
    });
    const draft = await this.deps.emailRepository.create({
      opportunityId: context.opportunityId,
      organizationId: context.organizationId,
      contactId: context.contactId,
      eventYear: context.eventYear,
      purpose: guardrail.effectivePurpose,
      state: "draft",
      gmailDraftId: gmail.draftId,
      gmailMessageId: gmail.messageId,
      gmailThreadId: gmail.threadId ?? null,
      recipientEmail: context.recipientEmail!,
      recipientName: context.recipientName,
      subject: generated.subject,
      body: generated.body,
    });
    await this.deps.workflowSink?.recordDraftCreated?.({
      opportunityId: draft.opportunityId,
      draftId: draft.id,
    });
    return { ok: true, draft };
  }

  async saveDraft(input: {
    opportunityId: string;
    draftId: string;
    subject: string;
    body: string;
  }): Promise<OpportunityEmailRecord> {
    return this.persistDraftContent(
      await this.requireOwnedDraft(input.opportunityId, input.draftId),
      input.subject,
      input.body,
    );
  }

  async rewriteDraft(input: {
    opportunityId: string;
    draftId: string;
    action: DraftRewriteAction;
    subject: string;
    body: string;
  }) {
    const existing = await this.requireOwnedDraft(
      input.opportunityId,
      input.draftId,
    );
    if (!this.deps.rewriteAdapter)
      throw serviceError("OPPORTUNITY_EMAIL_REWRITE_UNAVAILABLE");
    const rewritten = await this.deps.rewriteAdapter.rewrite({
      opportunityId: input.opportunityId,
      draftId: input.draftId,
      purpose: existing.purpose,
      action: input.action,
      subject: input.subject,
      body: input.body,
    });
    const draft = await this.persistDraftContent(
      existing,
      rewritten.subject,
      rewritten.body,
    );
    return { draft, undoSubject: input.subject, undoBody: input.body };
  }

  async sendDraft(input: {
    opportunityId: string;
    draftId: string;
    requestKey: string;
  }): Promise<{ draft: OpportunityEmailRecord; followUpReferenceAt: Date }> {
    const safety = this.deps.dispatchSafety?.enabled()
      ? this.deps.dispatchSafety
      : undefined;
    const recovered = await safety?.recover("opportunity_email", input.draftId);
    if (recovered?.confirmation) {
      const existing = await this.requireOwnedDraft(
        input.opportunityId,
        input.draftId,
      );
      return this.confirmSent(
        existing,
        input.requestKey,
        {
          ...recovered.confirmation,
          sentAt: new Date(recovered.confirmation.sentAt),
        },
        recovered,
      );
    }
    const prior = await this.deps.emailRepository.findBySendRequestKey?.(
      input.requestKey,
    );
    if (
      prior?.id === input.draftId &&
      prior.opportunityId === input.opportunityId &&
      prior.state === "sent" &&
      prior.sentAt
    ) {
      await this.recordPromotion(prior, {
        messageId: prior.gmailMessageId ?? "",
        threadId: prior.gmailThreadId,
        sentAt: prior.sentAt,
      }).catch(() => undefined);
      return { draft: prior, followUpReferenceAt: prior.sentAt };
    }
    let existing = await this.requireOwnedDraft(
      input.opportunityId,
      input.draftId,
    );
    if (existing.state === "sent" && existing.sentAt)
      return { draft: existing, followUpReferenceAt: existing.sentAt };
    if (!this.deps.gmailDraftProvider.sendDraft)
      throw serviceError("OPPORTUNITY_EMAIL_SEND_UNAVAILABLE");
    if (this.deps.promotion) {
      const prepared = await this.deps.promotion.prepareBody({
        sourceKind: "opportunity_email",
        emailRecordId: existing.id,
        opportunityId: existing.opportunityId,
        organizationId: existing.organizationId,
        bookingId: null,
        contactId: existing.contactId,
        officeAccountId: null,
        eventYear: existing.eventYear,
        templateCategory:
          existing.purpose === "new_outreach" ? "outreach" : "follow_up",
        templateCode: null,
        body: existing.body,
        attemptedAt: this.deps.now?.() ?? new Date(),
      });
      if (prepared.body !== existing.body) {
        existing = safety
          ? { ...existing, body: prepared.body }
          : await this.persistDraftContent(
              existing,
              existing.subject,
              prepared.body,
            );
      }
    }
    const content = {
      to: existing.recipientEmail,
      subject: existing.subject,
      body: existing.body,
    };
    let claim: Awaited<ReturnType<DispatchSafety["claim"]>> | undefined;
    try {
      claim = await safety?.claim("opportunity_email", existing.id, content);
    } catch (error) {
      await this.deps.emailRepository.update(existing.id, {
        state: "failed",
        lastFailureCode: "OUTREACH_OFFER_REVIEW_REQUIRED",
        lastFailureMessage: errorMessage(error),
      });
      throw error;
    }
    let confirmation: ConfirmedSend;
    try {
      confirmation = await this.deps.gmailDraftProvider.sendDraft({
        draftId: existing.gmailDraftId!,
        ...(claim
          ? {
              content,
              threadId: existing.gmailThreadId,
              beforeSend: () =>
                safety!.assertCurrent?.(claim) ?? Promise.resolve(),
            }
          : {}),
      });
    } catch (error) {
      if (
        !claim &&
        errorCode(error) === "GMAIL_SEND_OUTCOME_UNCERTAIN" &&
        existing.gmailMessageId &&
        this.deps.gmailDraftProvider.reconcileSend
      ) {
        const reconciled = await this.deps.gmailDraftProvider.reconcileSend({
          draftId: existing.gmailDraftId!,
          messageId: existing.gmailMessageId,
        });
        if (reconciled)
          return this.confirmSent(existing, input.requestKey, reconciled);
      }
      if (claim && safety) {
        const failed = await safety.fail(claim, error);
        if (!failed)
          throw serviceError("OUTREACH_DELIVERY_OUTCOME_REVIEW_REQUIRED");
      }
      await this.recordDeliveryFailure(
        existing,
        "send",
        input.requestKey,
        error,
      );
      throw serviceError(errorCode(error));
    }
    if (claim && safety) await safety.finish(claim, confirmation);
    return this.confirmSent(existing, input.requestKey, confirmation, claim);
  }

  async scheduleDraft(input: {
    opportunityId: string;
    draftId: string;
    requestKey: string;
    scheduledFor: Date;
  }): Promise<{ draft: OpportunityEmailRecord; followUpReferenceAt: Date }> {
    const prior = await this.deps.emailRepository.findByScheduleRequestKey?.(
      input.requestKey,
    );
    if (
      prior?.id === input.draftId &&
      prior.opportunityId === input.opportunityId &&
      prior.state === "scheduled" &&
      prior.scheduledFor
    )
      return { draft: prior, followUpReferenceAt: prior.scheduledFor };
    const existing = await this.requireOwnedDraft(
      input.opportunityId,
      input.draftId,
    );
    const draft = await this.deps.emailRepository.update(existing.id, {
      state: "scheduled",
      scheduledFor: input.scheduledFor,
      sentAt: null,
      scheduleRequestKey: input.requestKey,
      lastFailureCode: null,
      lastFailureMessage: null,
    });
    await this.deps.workflowSink?.recordScheduled({
      opportunityId: existing.opportunityId,
      draftId: existing.id,
      scheduledFor: input.scheduledFor,
    });
    return { draft, followUpReferenceAt: input.scheduledFor };
  }

  async retryDraft(input: {
    opportunityId: string;
    draftId: string;
    requestKey: string;
  }): Promise<{
    draft: OpportunityEmailRecord;
    followUpReferenceAt: Date | null;
  }> {
    const existing = await this.requireOwnedDraft(
      input.opportunityId,
      input.draftId,
    );
    if (existing.scheduledFor)
      return this.scheduleDraft({
        ...input,
        scheduledFor: existing.scheduledFor,
      });
    return this.sendDraft(input);
  }

  private async confirmSent(
    existing: OpportunityEmailRecord,
    requestKey: string,
    confirmation: ConfirmedSend,
    claim?: DispatchClaim,
  ) {
    const draft = await this.deps.emailRepository.update(existing.id, {
      state: "sent",
      sentAt: confirmation.sentAt,
      scheduledFor: null,
      sendRequestKey: requestKey,
      gmailMessageId: confirmation.messageId,
      gmailThreadId: confirmation.threadId ?? existing.gmailThreadId,
      lastFailureCode: null,
      lastFailureMessage: null,
    });
    const results = await Promise.allSettled([
      this.deps.workflowSink?.recordSent({
        opportunityId: existing.opportunityId,
        draftId: existing.id,
        sentAt: confirmation.sentAt,
        messageId: confirmation.messageId,
        threadId: confirmation.threadId ?? existing.gmailThreadId,
      }),
      this.recordPromotion(draft, confirmation),
      this.deps.outreachEvents?.replay(existing.opportunityId),
    ]);
    let trackingReviewRequired = results.some((r) => r.status === "rejected");
    if (claim)
      await this.deps.dispatchSafety
        ?.markTracking?.(claim, !trackingReviewRequired)
        .catch(() => {
          trackingReviewRequired = true;
        });
    return {
      draft,
      followUpReferenceAt: confirmation.sentAt,
      trackingReviewRequired,
    };
  }

  private async recordPromotion(
    draft: OpportunityEmailRecord,
    confirmation: ConfirmedSend,
  ): Promise<void> {
    if (!this.deps.promotion) return;
    await this.deps.promotion.recordConfirmedSend({
      sourceKind: "opportunity_email",
      emailRecordId: draft.id,
      opportunityId: draft.opportunityId,
      organizationId: draft.organizationId,
      bookingId: null,
      contactId: draft.contactId,
      officeAccountId: null,
      eventYear: draft.eventYear,
      templateCategory:
        draft.purpose === "new_outreach" ? "outreach" : "follow_up",
      templateCode: null,
      sentAt: confirmation.sentAt,
      gmailMessageId: confirmation.messageId || null,
      gmailThreadId: confirmation.threadId ?? draft.gmailThreadId,
    });
  }

  private async recordDeliveryFailure(
    existing: OpportunityEmailRecord,
    operation: "send" | "schedule",
    requestKey: string,
    error: unknown,
    scheduledFor?: Date,
  ): Promise<void> {
    const code = errorCode(error);
    const message = errorMessage(error);
    await this.deps.emailRepository.update(existing.id, {
      state: "failed",
      ...(operation === "send"
        ? { sendRequestKey: requestKey }
        : { scheduleRequestKey: requestKey }),
      ...(scheduledFor ? { scheduledFor } : {}),
      lastFailureCode: code,
      lastFailureMessage: message,
    });
    await this.deps.workflowSink?.recordFailure({
      opportunityId: existing.opportunityId,
      draftId: existing.id,
      operation,
      code,
      message,
    });
  }

  private async requireOwnedDraft(
    opportunityId: string,
    draftId: string,
  ): Promise<OpportunityEmailRecord> {
    const existing = await this.deps.emailRepository.getById(draftId);
    if (!existing) throw serviceError("OPPORTUNITY_EMAIL_DRAFT_NOT_FOUND");
    if (existing.opportunityId !== opportunityId)
      throw serviceError("OPPORTUNITY_EMAIL_DRAFT_MISMATCH");
    if (!existing.gmailDraftId)
      throw serviceError("OPPORTUNITY_EMAIL_GMAIL_DRAFT_MISSING");
    return existing;
  }

  private async persistDraftContent(
    existing: OpportunityEmailRecord,
    subject: string,
    body: string,
  ): Promise<OpportunityEmailRecord> {
    const gmail = await this.deps.gmailDraftProvider.updateDraft({
      draftId: existing.gmailDraftId!,
      to: existing.recipientEmail,
      subject,
      body,
    });
    const draft = await this.deps.emailRepository.update(existing.id, {
      subject,
      body,
      state: "draft",
      gmailDraftId: gmail.draftId,
      gmailMessageId: gmail.messageId,
      gmailThreadId: gmail.threadId ?? existing.gmailThreadId,
      lastFailureCode: null,
      lastFailureMessage: null,
    });
    await this.deps.workflowSink?.recordDraftUpdated?.({
      opportunityId: existing.opportunityId,
      draftId: existing.id,
    });
    return draft;
  }
}
