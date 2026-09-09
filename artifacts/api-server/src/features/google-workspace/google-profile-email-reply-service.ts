import { buildGmailRawMessage } from "./google-api-client";
import { PostgresGoogleConnectionRepository } from "./google-connection-repository";
import type { GoogleGmailDeliveryClient } from "./google-gmail-delivery-client";
import { PostgresGoogleProfileEmailArchiveRepository } from "./google-profile-email-archive-repository";
import type {
  ArchivedProfileEmailThread,
  GoogleProfileEmailArchiveAccess,
} from "./google-profile-email-archive-types";

type DeliveryConnection = {
  createGmailDeliveryClient(): Promise<{
    connectionId: string;
    client: GoogleGmailDeliveryClient;
  } | null>;
};

function errorCode(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    return String((error as { code: string }).code);
  }
  if (error instanceof Error && error.message.startsWith("GOOGLE_WORKSPACE_")) {
    return error.message;
  }
  return "GOOGLE_WORKSPACE_GMAIL_SEND_FAILED";
}

function emailAddress(value: string): string | null {
  const bracketed = value.match(/<([^<>\s@]+@[^<>\s@]+)>/);
  const candidate = (bracketed?.[1] ?? value).trim().toLowerCase();
  const plain = candidate.match(/[^\s,;<>]+@[^\s,;<>]+\.[^\s,;<>]+/);
  return plain?.[0] ?? null;
}

function replyRecipient(conversation: ArchivedProfileEmailThread): string | null {
  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    const message = conversation.messages[index]!;
    if (message.direction !== "outgoing") {
      const value = emailAddress(message.from);
      if (value) return value;
    }
  }
  return null;
}

function replySubject(subject: string): string {
  const clean = subject.trim() || "(No subject)";
  return /^re:/i.test(clean) ? clean : `Re: ${clean}`;
}

export class GoogleProfileEmailReplyService {
  private readonly connection: DeliveryConnection;
  private readonly archive: GoogleProfileEmailArchiveAccess;
  private readonly now: () => Date;

  constructor(options?: {
    connection?: DeliveryConnection;
    archive?: GoogleProfileEmailArchiveAccess;
    now?: () => Date;
  }) {
    this.connection =
      options?.connection ?? new PostgresGoogleConnectionRepository();
    this.archive =
      options?.archive ?? new PostgresGoogleProfileEmailArchiveRepository();
    this.now = options?.now ?? (() => new Date());
  }

  async reply(input: {
    organizationId: string;
    conversationId: string;
    bodyText: string;
    actorId: string;
  }): Promise<{
    conversation: ArchivedProfileEmailThread;
    gmailMessageId: string;
    gmailThreadId: string;
  }> {
    const bodyText = input.bodyText.trim();
    if (
      !input.organizationId.trim() ||
      !input.conversationId.trim() ||
      !input.actorId.trim() ||
      !bodyText ||
      bodyText.length > 100_000
    ) {
      throw new Error("GOOGLE_WORKSPACE_PROFILE_EMAIL_REPLY_INVALID");
    }

    const conversation = await this.archive.getForOrganization({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
    });
    if (!conversation) {
      throw new Error("GOOGLE_WORKSPACE_PROFILE_EMAIL_NOT_FOUND");
    }
    const to = replyRecipient(conversation);
    if (!to) {
      throw new Error("GOOGLE_WORKSPACE_PROFILE_EMAIL_RECIPIENT_MISSING");
    }

    const connected = await this.connection.createGmailDeliveryClient();
    if (!connected) throw new Error("GOOGLE_WORKSPACE_NOT_CONNECTED");
    const subject = replySubject(conversation.subject);
    const raw = buildGmailRawMessage({ to, subject, body: bodyText });
    const latestThreadId = conversation.providerThreadIds.at(-1) ?? null;

    let sent;
    try {
      sent = await connected.client.sendGmailMessage({
        raw,
        ...(latestThreadId ? { threadId: latestThreadId } : {}),
      });
    } catch (error) {
      if (!latestThreadId || errorCode(error) !== "GOOGLE_WORKSPACE_GMAIL_SOURCE_NOT_FOUND") {
        throw error;
      }
      sent = await connected.client.sendGmailMessage({ raw });
    }
    if (!sent.threadId) {
      throw Object.assign(
        new Error("GOOGLE_WORKSPACE_GMAIL_SEND_OUTCOME_UNCERTAIN"),
        { code: "GOOGLE_WORKSPACE_GMAIL_SEND_OUTCOME_UNCERTAIN" },
      );
    }

    const now = this.now();
    const previous = conversation.messages.at(-1);
    const saved = await this.archive.upsertThread({
      conversationId: conversation.id,
      organizationId: conversation.organizationId,
      contactId: conversation.contactId,
      gmailThreadId: sent.threadId,
      subject: conversation.subject,
      originalGmailUrl:
        `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(sent.threadId)}`,
      archiveState: conversation.archiveState === "partial" ? "partial" : "complete",
      lastSyncedAt: now,
      messages: [{
        gmailMessageId: sent.messageId,
        gmailThreadId: sent.threadId,
        internalDateMs: now.getTime(),
        from: previous?.direction === "incoming" ? previous.to : "",
        to,
        cc: "",
        subject,
        date: now.toUTCString(),
        direction: "outgoing",
        bodyText,
        attachments: [],
      }],
    });

    return {
      conversation: saved,
      gmailMessageId: sent.messageId,
      gmailThreadId: sent.threadId,
    };
  }
}
