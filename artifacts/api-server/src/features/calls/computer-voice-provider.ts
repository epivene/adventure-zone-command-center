import type { ComputerCallStatus } from "./computer-calling-types";

export interface ComputerVoiceProvider {
  createBrowserToken(input: { identity: "owner"; ttlSeconds: number }): string;
  validateWebhook(input: {
    signature: string;
    url: string;
    params: Record<string, string>;
  }): boolean;
  createOutboundTwiml(input: {
    destination: string;
    callerId: string;
    statusCallbackUrl: string;
  }): string;
  normalizeStatus(status: string): ComputerCallStatus;
}
