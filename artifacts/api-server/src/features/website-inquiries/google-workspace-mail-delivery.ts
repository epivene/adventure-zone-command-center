import { buildGmailRawMessage } from "../google-workspace/google-api-client";
import type { GoogleGmailDeliveryClient } from "../google-workspace/google-gmail-delivery-client";
import {
  createMailDeliveryFromEnv,
  type MailDelivery,
} from "../office/mail-delivery";

type GoogleDeliveryConnection = {
  createGmailDeliveryClient(): Promise<{
    connectionId: string;
    client: Pick<GoogleGmailDeliveryClient, "sendGmailMessage">;
  } | null>;
};

export function createGoogleWorkspaceMailDelivery(
  connection: GoogleDeliveryConnection,
  createFallback: () => MailDelivery = () => createMailDeliveryFromEnv(),
): MailDelivery {
  return {
    async send(input) {
      const connected = await connection.createGmailDeliveryClient();
      if (!connected) return createFallback().send(input);
      const sent = await connected.client.sendGmailMessage({
        raw: buildGmailRawMessage(input),
      });
      return { messageId: sent.messageId };
    },
  };
}
