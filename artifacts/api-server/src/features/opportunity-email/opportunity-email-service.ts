import type { DraftGenerator } from "./draft-generator";
import { evaluateDraftGuardrails, type DraftBlocker } from "./draft-guardrails";
import type { DraftContext } from "./draft-context-resolver";
import type {
  CreateOpportunityEmailInput,
  OpportunityDraftPurpose,
  OpportunityEmailRecord,
  UpdateOpportunityEmailInput,
} from "./opportunity-email-types";

export type CreateOpportunityDraftResult =
  | { ok: true; draft: OpportunityEmailRecord }
  | { ok: false; blocker: DraftBlocker };

export type OpportunityEmailRepositoryPort = {
  getCurrentForOpportunity(opportunityId: string): Promise<OpportunityEmailRecord | null>;
  getById(id: string): Promise<OpportunityEmailRecord | null>;
  create(input: CreateOpportunityEmailInput): Promise<OpportunityEmailRecord>;
  update(id: string, patch: UpdateOpportunityEmailInput): Promise<OpportunityEmailRecord>;
};

export type GmailDraftProvider = {
  createDraft(input: {
    to: string;
    subject: string;
    body: string;
  }): Promise<{
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
};

export type OpportunityDraftBlockerSink = {
  record(input: { opportunityId: string; blocker: DraftBlocker }): Promise<void>;
};

export type OpportunityEmailServiceDependencies = {
  contextResolver: { resolve(opportunityId: string): Promise<DraftContext> };
  emailRepository: OpportunityEmailRepositoryPort;
  draftGenerator: DraftGenerator;
  gmailDraftProvider: GmailDraftProvider;
  blockerSink: OpportunityDraftBlockerSink;
};

function serviceError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

export class OpportunityEmailService {
  constructor(private readonly deps: OpportunityEmailServiceDependencies) {}

  async createDraft(input: {
    opportunityId: string;
    purpose: OpportunityDraftPurpose;
  }): Promise<CreateOpportunityDraftResult> {
    const context = await this.deps.contextResolver.resolve(input.opportunityId);
    const guardrail = evaluateDraftGuardrails(context, input.purpose);

    if (guardrail.blocker) {
      await this.deps.blockerSink.record({
        opportunityId: input.opportunityId,
        blocker: guardrail.blocker,
      });
      return { ok: false, blocker: guardrail.blocker };
    }

    const existing = await this.deps.emailRepository.getCurrentForOpportunity(input.opportunityId);
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

    return { ok: true, draft };
  }

  async saveDraft(input: {
    opportunityId: string;
    draftId: string;
    subject: string;
    body: string;
  }): Promise<OpportunityEmailRecord> {
    const existing = await this.deps.emailRepository.getById(input.draftId);
    if (!existing) throw serviceError("OPPORTUNITY_EMAIL_DRAFT_NOT_FOUND");
    if (existing.opportunityId !== input.opportunityId) {
      throw serviceError("OPPORTUNITY_EMAIL_DRAFT_MISMATCH");
    }
    if (!existing.gmailDraftId) {
      throw serviceError("OPPORTUNITY_EMAIL_GMAIL_DRAFT_MISSING");
    }

    const gmail = await this.deps.gmailDraftProvider.updateDraft({
      draftId: existing.gmailDraftId,
      to: existing.recipientEmail,
      subject: input.subject,
      body: input.body,
    });

    return this.deps.emailRepository.update(input.draftId, {
      subject: input.subject,
      body: input.body,
      state: "draft",
      gmailDraftId: gmail.draftId,
      gmailMessageId: gmail.messageId,
      gmailThreadId: gmail.threadId ?? existing.gmailThreadId,
      lastFailureCode: null,
      lastFailureMessage: null,
    });
  }
}
