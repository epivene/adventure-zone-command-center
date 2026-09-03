import twilio from "twilio";
import { Readable } from "node:stream";

import type { ComputerCallingConfig } from "./computer-calling-config";
import type { ComputerCallStatus } from "./computer-calling-types";
import type { ComputerVoiceProvider } from "./computer-voice-provider";
import type { InboundVoiceProvider, ProviderRecordingMedia, SignedWebhookInput } from "./inbound-voice-provider";

const statusMap: Record<string, ComputerCallStatus> = {
  initiated: "queued",
  queued: "queued",
  ringing: "ringing",
  "in-progress": "in-progress",
  completed: "completed",
  busy: "busy",
  "no-answer": "no-answer",
  canceled: "canceled",
  failed: "failed",
};

const voicemailGreetingUrl =
  "https://adventure-zone-command-center-1.onrender.com/audio/voicemail-greeting.mp3";

export class TwilioComputerVoiceProvider implements ComputerVoiceProvider, InboundVoiceProvider {
  constructor(private readonly config: ComputerCallingConfig, private readonly fetcher: typeof fetch = fetch) {}

  createBrowserToken(input: { identity: "owner"; ttlSeconds: number }): string;
  createBrowserToken(input: { identity: string; ttlSeconds: number; allowIncoming: boolean }): Promise<{ token: string; expiresAt: Date }>;
  createBrowserToken(input: { identity: "owner"; ttlSeconds: number } | { identity: string; ttlSeconds: number; allowIncoming: boolean }): string | Promise<{ token: string; expiresAt: Date }> {
    const token = new twilio.jwt.AccessToken(this.config.accountSid, this.config.apiKeySid, this.config.apiKeySecret, { identity: input.identity, ttl: input.ttlSeconds });
    token.addGrant(new twilio.jwt.AccessToken.VoiceGrant({ outgoingApplicationSid: this.config.twimlAppSid, incomingAllow: "allowIncoming" in input && input.allowIncoming }));
    const value = token.toJwt();
    return "allowIncoming" in input
      ? Promise.resolve({ token: value, expiresAt: new Date(Date.now() + input.ttlSeconds * 1000) })
      : value;
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
  createClientDialTwiml(input: { identity: string; sessionId: string; actionUrl: string; statusCallbackUrl: string }): string {
    const response = new twilio.twiml.VoiceResponse();
    const client = response.dial({ action: input.actionUrl, method: "POST", answerOnBridge: true }).client({ statusCallback: input.statusCallbackUrl, statusCallbackEvent: ["initiated", "answered", "completed"] }, input.identity);
    client.parameter({ name: "inboundSessionId", value: input.sessionId });
    return response.toString();
  }
  createVoicemailTwiml(input: { actionUrl: string; recordingStatusCallbackUrl: string; maxSeconds: number }): string {
    const response = new twilio.twiml.VoiceResponse();
    response.play(voicemailGreetingUrl);
    response.record({ action: input.actionUrl, method: "POST", recordingStatusCallback: input.recordingStatusCallbackUrl, recordingStatusCallbackEvent: ["completed"], maxLength: input.maxSeconds, playBeep: true, transcribe: false });
    return response.toString();
  }
  async redirectCallToVoicemail(input: { callSid: string; twiml: string }): Promise<void> {
    const client = twilio(this.config.apiKeySid, this.config.apiKeySecret, { accountSid: this.config.accountSid });
    await client.calls(input.callSid).update({ twiml: input.twiml });
  }
  createUnavailableTwiml(): string { const response = new twilio.twiml.VoiceResponse(); response.say("The Adventure Zone cannot answer due to a temporary technical problem. Please try again later."); response.hangup(); return response.toString(); }
  async getRecordingMedia(recordingSid: string): Promise<ProviderRecordingMedia> {
    const response = await this.fetcher(
      `https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}/Recordings/${recordingSid}.mp3`,
      { headers: { Authorization: `Basic ${Buffer.from(`${this.config.apiKeySid}:${this.config.apiKeySecret}`).toString("base64")}` } },
    );
    if (!response.ok) throw new Error(`Twilio recording download failed with status ${response.status}`);
    return { body: Readable.from(Buffer.from(await response.arrayBuffer())), contentType: response.headers.get("content-type") ?? "audio/mpeg" };
  }
  async deleteRecording(recordingSid: string): Promise<"deleted" | "already_absent"> {
    const client = twilio(this.config.apiKeySid, this.config.apiKeySecret, { accountSid: this.config.accountSid });
    try { await client.recordings(recordingSid).remove(); return "deleted"; } catch (error: any) { if (error?.status === 404) return "already_absent"; throw error; }
  }
}
