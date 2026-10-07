import { PostgresGoogleConnectionRepository } from "./google-connection-repository";
import type { GoogleWorkspaceReadClient, GoogleThreadDetail } from "./google-api-types";
import {
  GoogleProfileFileService,
  type GoogleProfileFile,
} from "./google-profile-file-service";
import { PostgresGoogleProfileEmailArchiveRepository } from "./google-profile-email-archive-repository";
import type {
  ArchivedProfileEmailThread,
  GoogleProfileEmailArchiveAccess,
  ProfileEmailArchiveState,
} from "./google-profile-email-archive-types";
import { PostgresGoogleValidationRepository } from "./google-validation-repository";

type ConnectionAccess = {
  createReadClient(): Promise<GoogleWorkspaceReadClient | null>;
};

type ValidationAccess = {
  organizationOwnsApprovedThread(input: {
    organizationId: string;
    threadId: string;
  }): Promise<boolean>;
};

type FileAccess = {
  copyApprovedThreadAttachments(input: {
    organizationId: string;
    threadId: string;
  }): Promise<GoogleProfileFile[]>;
};

function safeErrorCode(error: unknown): string {
  if (error instanceof Error && error.message.startsWith("GOOGLE_WORKSPACE_")) {
    return error.message;
  }
  return "GOOGLE_WORKSPACE_PROFILE_EMAIL_ARCHIVE_REFRESH_FAILED";
}

function gmailUrl(threadId: string): string {
  return `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(threadId)}`;
}

function archiveMessages(detail: GoogleThreadDetail) {
  return detail.messages.map((message) => ({
    gmailMessageId: message.id,
    gmailThreadId: detail.id,
    internalDateMs: message.internalDateMs,
    from: message.from,
    to: message.to,
    cc: message.cc,
    subject: message.subject,
    date: message.date,
    direction: message.direction,
    bodyText: message.bodyText,
    ...(message.bodyHtml ? {bodyHtml:message.bodyHtml} : {}),
    attachments: message.attachments,
  }));
}

function attachmentState(
  detail: GoogleThreadDetail,
  files: GoogleProfileFile[],
): ProfileEmailArchiveState {
  const wanted = new Set(
    detail.messages.flatMap((message) =>
      message.attachments.map(
        (attachment) => `${message.id}\u0000${attachment.attachmentId}`,
      ),
    ),
  );
  if (!wanted.size) return "complete";

  const available = new Set(
    files
      .filter(
        (file) =>
          file.threadId === detail.id && file.availability === "available",
      )
      .map((file) => `${file.messageId}\u0000${file.attachmentId}`),
  );
  return [...wanted].every((key) => available.has(key))
    ? "complete"
    : "partial";
}

export class GoogleProfileEmailArchiveService {
  private readonly connection: ConnectionAccess;
  private readonly validation: ValidationAccess;
  private readonly archive: GoogleProfileEmailArchiveAccess;
  private readonly files: FileAccess;
  private readonly now: () => Date;

  constructor(options?: {
    connection?: ConnectionAccess;
    validation?: ValidationAccess;
    archive?: GoogleProfileEmailArchiveAccess;
    files?: FileAccess;
    now?: () => Date;
  }) {
    this.connection =
      options?.connection ?? new PostgresGoogleConnectionRepository();
    this.validation =
      options?.validation ?? new PostgresGoogleValidationRepository();
    this.archive =
      options?.archive ?? new PostgresGoogleProfileEmailArchiveRepository();
    this.files = options?.files ?? new GoogleProfileFileService();
    this.now = options?.now ?? (() => new Date());
  }

  async archiveApprovedThread(input: {
    organizationId: string;
    contactId: string | null;
    gmailThreadId: string;
  }): Promise<ArchivedProfileEmailThread> {
    if (!input.organizationId.trim() || !input.gmailThreadId.trim()) {
      throw new Error("GOOGLE_WORKSPACE_PROFILE_EMAIL_ARCHIVE_INPUT_INVALID");
    }

    const owns = await this.validation.organizationOwnsApprovedThread({
      organizationId: input.organizationId,
      threadId: input.gmailThreadId,
    });
    if (!owns) {
      throw new Error("GOOGLE_WORKSPACE_PROFILE_THREAD_NOT_FOUND");
    }

    const existing = await this.archive.findByProviderThread(input);

    try {
      const client = await this.connection.createReadClient();
      if (!client) throw new Error("GOOGLE_WORKSPACE_NOT_CONNECTED");
      if (!client.getThreadDetail) {
        throw new Error("GOOGLE_WORKSPACE_PROFILE_EMAIL_UNAVAILABLE");
      }

      const detail = await client.getThreadDetail(input.gmailThreadId);
      const syncedAt = this.now();
      const messages = archiveMessages(detail);
      const pending = await this.archive.upsertThread({
        conversationId: existing?.id,
        organizationId: input.organizationId,
        contactId: input.contactId,
        gmailThreadId: input.gmailThreadId,
        subject: detail.subject || detail.messages.at(-1)?.subject || "",
        originalGmailUrl:
          detail.originalGmailUrl || gmailUrl(input.gmailThreadId),
        archiveState: "pending",
        lastSyncedAt: syncedAt,
        messages,
      });

      let state: ProfileEmailArchiveState = "complete";
      if (detail.messages.some((message) => message.attachments.length > 0)) {
        try {
          const files = await this.files.copyApprovedThreadAttachments({
            organizationId: input.organizationId,
            threadId: input.gmailThreadId,
          });
          state = attachmentState(detail, files);
        } catch {
          // The durable message body is already saved. Attachment retries must
          // never roll it back or make the profile conversation disappear.
          state = "partial";
        }
      }

      return this.archive.upsertThread({
        conversationId: pending.id,
        organizationId: input.organizationId,
        contactId: input.contactId,
        gmailThreadId: input.gmailThreadId,
        subject: detail.subject || detail.messages.at(-1)?.subject || "",
        originalGmailUrl:
          detail.originalGmailUrl || gmailUrl(input.gmailThreadId),
        archiveState: state,
        lastSyncedAt: syncedAt,
        messages,
      });
    } catch (error) {
      if (!existing) throw error;
      const code = safeErrorCode(error);
      await this.archive.recordSyncFailure({
        conversationId: existing.id,
        code,
        now: this.now(),
      });
      return { ...existing, lastGmailErrorCode: code };
    }
  }
}
