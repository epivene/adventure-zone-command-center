import { buildGmailRawMessage } from "../google-workspace/google-api-client";
import type { GoogleGmailDraftClient } from "../google-workspace/google-api-types";

export type OfficeGmailDraftResult = {
  draftId: string;
  messageId: string;
  threadId: string | null;
};

export class OfficeGmailProviderError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "OfficeGmailProviderError";
  }
}

function providerFailure(error: unknown): OfficeGmailProviderError {
  const sourceCode =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
  if (sourceCode.includes("OUTCOME_UNCERTAIN")) {
    return new OfficeGmailProviderError(
      sourceCode.includes("SEND")
        ? "GMAIL_SEND_OUTCOME_UNKNOWN"
        : "GMAIL_DRAFT_OUTCOME_UNKNOWN",
    );
  }
  if (sourceCode.includes("REAUTHORIZATION") || sourceCode.includes("SCOPE")) {
    return new OfficeGmailProviderError("GMAIL_CONNECTION_REQUIRED");
  }
  return new OfficeGmailProviderError("GMAIL_DRAFT_FAILED");
}

export class OfficeGmailProvider {
  constructor(
    private readonly client: GoogleGmailDraftClient,
    private readonly delivery?: {
      sendGmailDraft(input: {
        draftId: string;
        beforeSend?: () => Promise<void>;
      }): Promise<{ messageId: string; threadId: string | null }>;
    },
  ) {}

  async createOrUpdateDraft(input: {
    gmailDraftId: string | null;
    to: string;
    subject: string;
    html: string;
  }): Promise<OfficeGmailDraftResult> {
    const raw = buildGmailRawMessage({
      to: input.to,
      subject: input.subject,
      body: input.html,
      bodyFormat: "html",
    });
    try {
      if (input.gmailDraftId && !this.client.updateGmailDraft) {
        throw new OfficeGmailProviderError("GMAIL_DRAFT_UPDATE_UNAVAILABLE");
      }
      const result = input.gmailDraftId
        ? await this.client.updateGmailDraft!({
            draftId: input.gmailDraftId,
            raw,
          })
        : await this.client.createGmailDraft({ raw });
      return { ...result, threadId: result.threadId ?? null };
    } catch (error) {
      throw providerFailure(error);
    }
  }

  async sendDraft(input: {
    draftId: string;
    beforeSend?: () => Promise<void>;
  }): Promise<{ messageId: string; threadId: string; sentAt: Date }> {
    if (!this.delivery) {
      throw new OfficeGmailProviderError("GMAIL_SEND_UNAVAILABLE");
    }
    await input.beforeSend?.();
    try {
      const sent = await this.delivery.sendGmailDraft({
        draftId: input.draftId,
      });
      if (!sent.threadId) {
        throw new OfficeGmailProviderError("GMAIL_SEND_OUTCOME_UNKNOWN");
      }
      return { ...sent, threadId: sent.threadId, sentAt: new Date() };
    } catch (error) {
      if (error instanceof OfficeGmailProviderError) throw error;
      throw providerFailure(error);
    }
  }
}
