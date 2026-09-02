import twilio from "twilio";

import type { ComputerCallingConfig } from "./computer-calling-config";
import type { ComputerCallStatus } from "./computer-calling-types";
import type { ComputerVoiceProvider } from "./computer-voice-provider";

const statusMap: Record<string, ComputerCallStatus> = {
  initiated: "created",
  queued: "queued",
  ringing: "ringing",
  "in-progress": "in-progress",
  completed: "completed",
  busy: "busy",
  "no-answer": "no-answer",
  canceled: "canceled",
  failed: "failed",
};

export class TwilioComputerVoiceProvider implements ComputerVoiceProvider {
  constructor(private readonly config: ComputerCallingConfig) {}

  createBrowserToken(input: { identity: "owner"; ttlSeconds: number }): string {
    const token = new twilio.jwt.AccessToken(
      this.config.accountSid,
      this.config.apiKeySid,
      this.config.apiKeySecret,
      { identity: input.identity, ttl: input.ttlSeconds },
    );
    token.addGrant(new twilio.jwt.AccessToken.VoiceGrant({
      outgoingApplicationSid: this.config.twimlAppSid,
    }));
    return token.toJwt();
  }

  validateWebhook(input: {
    signature: string;
    url: string;
    params: Record<string, string>;
  }): boolean {
    return twilio.validateRequest(this.config.authToken, input.signature, input.url, input.params);
  }

  createOutboundTwiml(input: {
    destination: string;
    callerId: string;
    statusCallbackUrl: string;
  }): string {
    const response = new twilio.twiml.VoiceResponse();
    const dial = response.dial({
      answerOnBridge: true,
      callerId: input.callerId,
      record: "do-not-record",
      timeout: 30,
    });
    dial.number({
      statusCallback: input.statusCallbackUrl,
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    }, input.destination);
    return response.toString();
  }

  normalizeStatus(status: string): ComputerCallStatus {
    return statusMap[status] ?? "unknown";
  }
}
