import { buildGmailRawMessage } from "@/features/google-workspace/google-api-client";
import type { PostgresGoogleConnectionRepository } from "@/features/google-workspace/google-connection-repository";

import type { GmailDraftProvider } from "./opportunity-email-service";

type GoogleConnection = Pick<
  PostgresGoogleConnectionRepository,
  "createGmailDraftClient" | "createGmailDeliveryClient"
>;

type Clock = { now(): Date };

function notConnected(): Error {
  return Object.assign(new Error("GOOGLE_WORKSPACE_NOT_CONNECTED"), {
    code: "GOOGLE_WORKSPACE_NOT_CONNECTED",
  });
}

export class GoogleOpportunityEmailProvider implements GmailDraftProvider {
  private readonly clock: Clock;

  constructor(
    private readonly connection: GoogleConnection,
    options?: { now?: () => Date },
  ) {
    this.clock = { now: options?.now ?? (() => new Date()) };
  }

  async createDraft(input: { to: string; subject: string; body: string }) {
    const connected = await this.connection.createGmailDraftClient();
    if (!connected) throw notConnected();
    const created = await connected.client.createGmailDraft({
      raw: buildGmailRawMessage(input),
    });
    return {
      draftId: created.draftId,
      messageId: created.messageId,
      threadId: null,
    };
  }

  async updateDraft(input: {
    draftId: string;
    to: string;
    subject: string;
    body: string;
  }) {
    const connected = await this.connection.createGmailDeliveryClient();
    if (!connected) throw notConnected();
    return connected.client.updateGmailDraft({
      draftId: input.draftId,
      raw: buildGmailRawMessage({
        to: input.to,
        subject: input.subject,
        body: input.body,
      }),
    });
  }

  async sendDraft(input: { draftId: string }) {
    const connected = await this.connection.createGmailDeliveryClient();
    if (!connected) throw notConnected();
    const sent = await connected.client.sendGmailDraft(input);
    return {
      messageId: sent.messageId,
      threadId: sent.threadId,
      sentAt: this.clock.now(),
    };
  }

  async reconcileSend(_input: { draftId: string }) {
    // We intentionally do not infer delivery from local state. A future reconciliation
    // implementation must verify the sent message through Gmail before returning it.
    return null;
  }
}
