import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createTwilioInboundVoiceWebhooksRouter } from "./twilio-inbound-voice-webhooks";

const inboundNumber = "+13035550101";
const voiceConfig = {
  accountSid: "AC00000000000000000000000000000000",
  apiKeySid: "SK00000000000000000000000000000000",
  apiKeySecret: "api-key-secret",
  authToken: "auth-token",
  twimlAppSid: "AP00000000000000000000000000000000",
  verifiedCallerId: "+13035550100",
  webhookBaseUrl: "https://calls.example.test",
};

function harness() {
  const record = vi.fn().mockResolvedValue(true);
  const provider = {
    validateWebhook: vi.fn().mockReturnValue(true),
    createBrowserToken: vi.fn(),
    createClientDialTwiml: vi.fn(),
    createVoicemailTwiml: vi.fn(),
    createUnavailableTwiml: vi.fn(),
    getRecordingMedia: vi.fn(),
    deleteRecording: vi.fn(),
  };
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use("/api", createTwilioInboundVoiceWebhooksRouter({
    getInboundConfig: () => ({
      enabled: true,
      config: {
        inboundNumber,
        retentionDays: 30,
        maxSeconds: 120,
        voiceConfig,
      },
      capability: {
        enabled: true,
        reason: "available",
        inboundNumberDisplay: "+1••••0101",
        retentionDays: 30,
        maxSeconds: 120,
      },
    }),
    isAssistedCallingEnabled: () => true,
    providerForConfig: () => provider,
    availability: {} as never,
    calls: {} as never,
    voicemails: { record } as never,
  }));
  return { app, provider, record };
}

function signed(builder: request.Test) {
  return builder.set("X-Twilio-Signature", "valid-signature");
}

describe("Twilio inbound callback endpoints", () => {
  it("signature-validates and acknowledges voicemail completion", async () => {
    const { app, provider } = harness();
    const body = {
      CallSid: "CA12345678",
      To: inboundNumber,
      RecordingSid: "RE12345678",
      RecordingStatus: "completed",
      RecordingDuration: "12",
    };

    const response = await signed(
      request(app).post("/api/webhooks/twilio/voice/inbound/voicemail"),
    ).type("form").send(body).expect(200);

    expect(response.headers["content-type"]).toMatch(/text\/xml/);
    expect(response.text).toContain("<Hangup");
    expect(provider.validateWebhook).toHaveBeenCalledWith({
      signature: "valid-signature",
      url: "https://calls.example.test/api/webhooks/twilio/voice/inbound/voicemail",
      params: body,
    });
  });

  it("signature-validates and acknowledges inbound call status", async () => {
    const { app, provider } = harness();
    const body = {
      CallSid: "CA87654321",
      ParentCallSid: "CA12345678",
      CallStatus: "completed",
    };

    await signed(
      request(app).post("/api/webhooks/twilio/voice/inbound/status"),
    ).type("form").send(body).expect(204);

    expect(provider.validateWebhook).toHaveBeenCalledWith({
      signature: "valid-signature",
      url: "https://calls.example.test/api/webhooks/twilio/voice/inbound/status",
      params: body,
    });
  });

  it("accepts Twilio's recording callback without a To field and saves the recording", async () => {
    const { app, record } = harness();

    await signed(
      request(app).post("/api/webhooks/twilio/voice/inbound/recording"),
    ).type("form").send({
      CallSid: "CA12345678",
      RecordingSid: "RE12345678",
      RecordingStatus: "completed",
      RecordingDuration: "12",
    }).expect(204);

    expect(record).toHaveBeenCalledWith({
      parentSid: "CA12345678",
      recordingSid: "RE12345678",
      duration: 12,
      retentionDays: 30,
    });
  });

  it("rejects unsigned voicemail-completion and status callbacks", async () => {
    const { app, provider } = harness();

    await request(app).post("/api/webhooks/twilio/voice/inbound/voicemail")
      .type("form")
      .send({ CallSid: "CA12345678", To: inboundNumber })
      .expect(403);
    await request(app).post("/api/webhooks/twilio/voice/inbound/status")
      .type("form")
      .send({ CallSid: "CA87654321", CallStatus: "completed" })
      .expect(403);

    expect(provider.validateWebhook).not.toHaveBeenCalled();
  });
});
