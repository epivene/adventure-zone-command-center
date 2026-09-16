import type { OfficeEmailDraftView } from "./office-email-types";
import type { OfficeGmailDraftResult } from "./office-gmail-provider";
import { OfficeGmailProviderError } from "./office-gmail-provider";

export type DesignEmailContentCommand = {
  projectId: string;
  accountId: string;
  subject: string;
};

type FrozenEmail = {
  versionId: string;
  html: string;
  htmlFingerprint: string;
};

type DesignRecipient = {
  organizationId: string;
  contactId: string;
  recipientEmail: string;
};

export type OfficeDesignEmailRepositoryPort = {
  resolveDesignRecipient(input: {
    projectId: string;
    accountId: string;
  }): Promise<DesignRecipient>;
  saveCanonicalDesignDraft(input: {
    accountId: string;
    projectId: string;
    versionId: string;
    organizationId: string;
    contactId: string;
    recipientEmail: string;
    subject: string;
    html: string;
  }): Promise<OfficeEmailDraftView>;
  markCanonicalGmailDraft(input: {
    draftId: string;
    accountId: string;
    gmailDraftId: string;
    gmailMessageId: string;
    gmailThreadId: string | null;
  }): Promise<OfficeEmailDraftView>;
  markCanonicalDraftFailed(input: {
    draftId: string;
    accountId: string;
    code: string;
    message: string;
  }): Promise<OfficeEmailDraftView>;
  findCanonicalByScheduleRequest(input: {
    accountId: string;
    requestKey: string;
  }): Promise<OfficeEmailDraftView | null>;
  findCanonicalByProject(input: {
    projectId: string;
    accountId: string;
  }): Promise<OfficeEmailDraftView | null>;
  findCanonicalBySendRequest(input: {
    accountId: string;
    requestKey: string;
  }): Promise<OfficeEmailDraftView | null>;
  scheduleCanonicalDraft(input: {
    draftId: string;
    accountId: string;
    requestKey: string;
    scheduledFor: Date;
    businessTimeZone: string;
  }): Promise<OfficeEmailDraftView>;
  rescheduleCanonicalDraft(input: {
    draftId: string;
    accountId: string;
    requestKey: string;
    scheduledFor: Date;
    businessTimeZone: string;
  }): Promise<OfficeEmailDraftView>;
  cancelCanonicalSchedule(input: {
    draftId: string;
    accountId: string;
  }): Promise<OfficeEmailDraftView>;
  claimCanonicalSend(input: {
    draftId: string;
    accountId: string;
    requestKey: string;
  }): Promise<OfficeEmailDraftView>;
  markCanonicalSent(input: {
    draftId: string;
    accountId: string;
    gmailDraftId: string;
    gmailMessageId: string;
    gmailThreadId: string;
    sentAt: Date;
    workerId?: string;
  }): Promise<OfficeEmailDraftView>;
  storeClaimedGmailDraft(input: {
    draftId: string;
    workerId: string;
    gmailDraftId: string;
    gmailMessageId: string;
    gmailThreadId: string | null;
  }): Promise<OfficeEmailDraftView>;
};

export type OfficeGmailProviderPort = {
  createOrUpdateDraft(input: {
    gmailDraftId: string | null;
    to: string;
    subject: string;
    html: string;
  }): Promise<OfficeGmailDraftResult>;
  sendDraft(input: {
    draftId: string;
    beforeSend?: () => Promise<void>;
  }): Promise<{ messageId: string; threadId: string; sentAt: Date }>;
};

type ApprovedCommand = {
  draftId: string;
  approvedFingerprint: string;
};

export type OfficeEmailApprovalPort = {
  assertApproved(input: ApprovedCommand): Promise<void>;
  currentApprovedFingerprint?(draftId: string): Promise<string>;
};

function assertValidSchedule(input: {
  scheduledFor: Date;
  businessTimeZone: string;
  now: Date;
}) {
  if (
    !(input.scheduledFor instanceof Date) ||
    !Number.isFinite(input.scheduledFor.valueOf())
  ) {
    throw new Error("EMAIL_SCHEDULE_INVALID");
  }
  if (input.scheduledFor <= input.now)
    throw new Error("EMAIL_SCHEDULE_NOT_FUTURE");
  try {
    new Intl.DateTimeFormat("en-US", {
      timeZone: input.businessTimeZone,
    }).format(input.now);
  } catch {
    throw new Error("EMAIL_TIME_ZONE_INVALID");
  }
}

export class OfficeDesignEmailService {
  constructor(
    private readonly deps: {
      repository: OfficeDesignEmailRepositoryPort;
      gmail: OfficeGmailProviderPort;
      freeze(input: {
        projectId: string;
        accountId: string;
      }): Promise<FrozenEmail>;
      approval?: OfficeEmailApprovalPort;
      now?: () => Date;
    },
  ) {}

  private async save(command: DesignEmailContentCommand) {
    const subject = command.subject.trim();
    if (!subject || /[\r\n]/.test(subject))
      throw new Error("EMAIL_SUBJECT_INVALID");
    const [recipient, frozen] = await Promise.all([
      this.deps.repository.resolveDesignRecipient(command),
      this.deps.freeze(command),
    ]);
    const draft = await this.deps.repository.saveCanonicalDesignDraft({
      ...command,
      ...recipient,
      versionId: frozen.versionId,
      html: frozen.html,
      subject,
    });
    return { draft, frozen };
  }

  async saveInApp(
    command: DesignEmailContentCommand,
  ): Promise<OfficeEmailDraftView> {
    return (await this.save(command)).draft;
  }

  async createGmailDraft(
    command: DesignEmailContentCommand,
  ): Promise<OfficeEmailDraftView> {
    const { draft } = await this.save(command);
    try {
      const gmail = await this.deps.gmail.createOrUpdateDraft({
        gmailDraftId: draft.gmailDraftId,
        to: draft.recipientEmail,
        subject: draft.subject,
        html: draft.body,
      });
      return await this.deps.repository.markCanonicalGmailDraft({
        draftId: draft.id,
        accountId: command.accountId,
        gmailDraftId: gmail.draftId,
        gmailMessageId: gmail.messageId,
        gmailThreadId: gmail.threadId,
      });
    } catch (error) {
      const code =
        error instanceof OfficeGmailProviderError
          ? error.code
          : "GMAIL_DRAFT_OUTCOME_UNKNOWN";
      await this.deps.repository.markCanonicalDraftFailed({
        draftId: draft.id,
        accountId: command.accountId,
        code,
        message:
          code === "GMAIL_DRAFT_OUTCOME_UNKNOWN"
            ? "Check Gmail for an existing draft before retrying."
            : "Gmail could not save this draft.",
      });
      throw error;
    }
  }

  private async assertApproved(input: ApprovedCommand) {
    await this.deps.approval?.assertApproved(input);
  }

  async schedule(
    command: DesignEmailContentCommand & {
      requestKey: string;
      scheduledFor: Date;
      businessTimeZone: string;
      approvedFingerprint: string;
    },
  ): Promise<OfficeEmailDraftView> {
    const replay =
      await this.deps.repository.findCanonicalByScheduleRequest(command);
    if (replay) return replay;
    const now = this.deps.now?.() ?? new Date();
    assertValidSchedule({ ...command, now });
    const { draft } = await this.save(command);
    await this.assertApproved({
      draftId: draft.id,
      approvedFingerprint: command.approvedFingerprint,
    });
    return this.deps.repository.scheduleCanonicalDraft({
      draftId: draft.id,
      accountId: command.accountId,
      requestKey: command.requestKey,
      scheduledFor: command.scheduledFor,
      businessTimeZone: command.businessTimeZone,
    });
  }

  async reschedule(input: {
    draftId: string;
    accountId: string;
    requestKey: string;
    scheduledFor: Date;
    businessTimeZone: string;
    approvedFingerprint: string;
  }) {
    const replay =
      await this.deps.repository.findCanonicalByScheduleRequest(input);
    if (replay) return replay;
    const now = this.deps.now?.() ?? new Date();
    assertValidSchedule({ ...input, now });
    await this.assertApproved(input);
    return this.deps.repository.rescheduleCanonicalDraft(input);
  }

  async cancel(input: { draftId: string; accountId: string }) {
    return this.deps.repository.cancelCanonicalSchedule(input);
  }

  async sendNow(
    command: DesignEmailContentCommand & {
      requestKey: string;
      approvedFingerprint: string;
    },
  ): Promise<OfficeEmailDraftView> {
    const replay =
      await this.deps.repository.findCanonicalBySendRequest(command);
    if (replay) return replay;
    const { draft } = await this.save(command);
    await this.assertApproved({
      draftId: draft.id,
      approvedFingerprint: command.approvedFingerprint,
    });
    let gmailDraft: OfficeGmailDraftResult;
    try {
      gmailDraft = await this.deps.gmail.createOrUpdateDraft({
        gmailDraftId: draft.gmailDraftId,
        to: draft.recipientEmail,
        subject: draft.subject,
        html: draft.body,
      });
      await this.deps.repository.markCanonicalGmailDraft({
        draftId: draft.id,
        accountId: command.accountId,
        gmailDraftId: gmailDraft.draftId,
        gmailMessageId: gmailDraft.messageId,
        gmailThreadId: gmailDraft.threadId,
      });
      await this.deps.repository.claimCanonicalSend({
        draftId: draft.id,
        accountId: command.accountId,
        requestKey: command.requestKey,
      });
      const sent = await this.deps.gmail.sendDraft({
        draftId: gmailDraft.draftId,
        beforeSend: () =>
          this.assertApproved({
            draftId: draft.id,
            approvedFingerprint: command.approvedFingerprint,
          }),
      });
      return await this.deps.repository.markCanonicalSent({
        draftId: draft.id,
        accountId: command.accountId,
        gmailDraftId: gmailDraft.draftId,
        gmailMessageId: sent.messageId,
        gmailThreadId: sent.threadId,
        sentAt: sent.sentAt,
      });
    } catch (error) {
      const sourceCode =
        error && typeof error === "object" && "code" in error
          ? String((error as { code?: unknown }).code)
          : error instanceof Error
            ? error.message
            : "";
      const code = sourceCode.startsWith("OUTREACH_")
        ? sourceCode
        : error instanceof OfficeGmailProviderError
          ? error.code
          : "GMAIL_SEND_OUTCOME_UNKNOWN";
      await this.deps.repository.markCanonicalDraftFailed({
        draftId: draft.id,
        accountId: command.accountId,
        code,
        message: code.startsWith("OUTREACH_")
          ? "Email approval changed before delivery. Review the current content."
          : code === "GMAIL_SEND_OUTCOME_UNKNOWN"
            ? "Check Gmail Sent and Drafts before retrying."
            : "Gmail could not send this email.",
      });
      throw error;
    }
  }

  async sendClaimed(input: {
    draft: OfficeEmailDraftView;
    workerId: string;
  }): Promise<OfficeEmailDraftView> {
    if (!input.draft.officeAccountId)
      throw new Error("OFFICE_EMAIL_ACCOUNT_REQUIRED");
    const approvedFingerprint =
      (await this.deps.approval?.currentApprovedFingerprint?.(
        input.draft.id,
      )) ?? "";
    await this.assertApproved({ draftId: input.draft.id, approvedFingerprint });
    const gmailDraft = await this.deps.gmail.createOrUpdateDraft({
      gmailDraftId: input.draft.gmailDraftId,
      to: input.draft.recipientEmail,
      subject: input.draft.subject,
      html: input.draft.body,
    });
    await this.deps.repository.storeClaimedGmailDraft({
      draftId: input.draft.id,
      workerId: input.workerId,
      gmailDraftId: gmailDraft.draftId,
      gmailMessageId: gmailDraft.messageId,
      gmailThreadId: gmailDraft.threadId,
    });
    const sent = await this.deps.gmail.sendDraft({
      draftId: gmailDraft.draftId,
      beforeSend: () =>
        this.assertApproved({ draftId: input.draft.id, approvedFingerprint }),
    });
    return this.deps.repository.markCanonicalSent({
      draftId: input.draft.id,
      accountId: input.draft.officeAccountId,
      workerId: input.workerId,
      gmailDraftId: gmailDraft.draftId,
      gmailMessageId: sent.messageId,
      gmailThreadId: sent.threadId,
      sentAt: sent.sentAt,
    });
  }
}
