import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ComputerCallingError } from "@/features/calls/computer-calling-service";
import { createTwilioVoiceWebhooksRouter } from "./twilio-voice-webhooks";

const SESSION_ID = "40000000-0000-4000-8000-000000000001";

function enabledConfig() {
  return {
    enabled: true as const,
    config: {
      accountSid: "AC123",
      apiKeySid: "SK123",
      apiKeySecret: "secret",
      authToken: "auth",
      twimlAppSid: "AP123",
      verifiedCallerId: "+15551234567",
      webhookBaseUrl: "https://calls.example.test",
    },
    capability: { enabled: true, reason: "available" as const, callerIdDisplay: "+15551234567" },
  };
}

function harness(overrides: Record<string, unknown> = {}) {
  const { mountPath = "", provider: providedProvider, ...dependencyOverrides } = overrides;
  const service = {
    consumeIntent: vi.fn().mockResolvedValue({
      sessionId: SESSION_ID,
      providerCallSid: "CA123",
      destination: "+15557654321",
      callerId: "+15551234567",
    }),
    applyProviderStatus: vi.fn().mockResolvedValue(undefined),
  };
  const provider: any = providedProvider ?? {
    validateWebhook: vi.fn().mockReturnValue(true),
    createOutboundTwiml: vi.fn().mockReturnValue("<?xml version=\"1.0\"?><Response><Dial/></Response>"),
    normalizeStatus: vi.fn().mockImplementation((status: string) => status === "in-progress" ? "in-progress" : "unknown"),
  };
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  const router = createTwilioVoiceWebhooksRouter({
    service: service as any,
    providerForConfig: () => provider as any,
    getConfig: enabledConfig,
    isAssistedCallingEnabled: () => true,
    clock: () => new Date("2026-09-01T12:00:00.000Z"),
    ...dependencyOverrides,
  });
  app.use(mountPath as string, router);
  return { app, service, provider };
}

function signed(requestBuilder: request.Test) {
  return requestBuilder.set("X-Twilio-Signature", "valid-signature");
}

describe("Twilio voice webhooks", () => {
  it("rejects missing and invalid signatures without requiring an owner token", async () => {
    const { app, provider } = harness();

    await request(app).post("/webhooks/twilio/voice/outbound")
      .type("form")
      .send({ CallSid: "CA123", sessionId: SESSION_ID })
      .expect(403, { error: "Forbidden" });

    provider.validateWebhook.mockReturnValue(false);
    await signed(request(app).post("/webhooks/twilio/voice/outbound"))
      .type("form")
      .send({ CallSid: "CA123", sessionId: SESSION_ID })
      .expect(403, { error: "Forbidden" });
  });

  it("validates the exact original URL and complete parsed form field map", async () => {
    const { app, provider } = harness();

    await signed(request(app).post("/webhooks/twilio/voice/outbound?edge=iad"))
      .type("form")
      .send({ CallSid: "CA123", sessionId: SESSION_ID, From: "client:owner", extra: "preserved" })
      .expect(200);

    expect(provider.validateWebhook).toHaveBeenCalledWith({
      signature: "valid-signature",
      url: "https://calls.example.test/webhooks/twilio/voice/outbound?edge=iad",
      params: { CallSid: "CA123", sessionId: SESSION_ID, From: "client:owner", extra: "preserved" },
    });
  });

  it("rejects an invalid signed form payload", async () => {
    const { app, service } = harness();

    await signed(request(app).post("/webhooks/twilio/voice/outbound"))
      .type("form")
      .send({ CallSid: "CA123" })
      .expect(400, { error: "invalid_request" });

    expect(service.consumeIntent).not.toHaveBeenCalled();
  });

  it("generates safe outbound-only TwiML from a signed client identity", async () => {
    const { app, service, provider } = harness();

    const response = await signed(request(app).post("/webhooks/twilio/voice/outbound"))
      .type("form")
      .send({ CallSid: "CA123", sessionId: SESSION_ID, From: "client:owner" })
      .expect("Content-Type", /text\/xml/)
      .expect(200);

    expect(response.text).toBe("<?xml version=\"1.0\"?><Response><Dial/></Response>");
    expect(service.consumeIntent).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      providerCallSid: "CA123",
      callerIdentity: "owner",
      now: new Date("2026-09-01T12:00:00.000Z"),
    });
    expect(provider.createOutboundTwiml).toHaveBeenCalledWith({
      destination: "+15557654321",
      callerId: "+15551234567",
      statusCallbackUrl: "https://calls.example.test/api/webhooks/twilio/voice/status",
    });
  });

  it("requires a signed Twilio client From identity", async () => {
    const { app, service } = harness();

    await signed(request(app).post("/webhooks/twilio/voice/outbound"))
      .type("form").send({ CallSid: "CA123", sessionId: SESSION_ID })
      .expect(400, { error: "invalid_request" });

    expect(service.consumeIntent).not.toHaveBeenCalled();
  });

  it("fails closed when the signed client identity does not own the intent", async () => {
    const { app, service } = harness();
    service.consumeIntent.mockRejectedValueOnce(new ComputerCallingError("intent_already_used"));

    await signed(request(app).post("/webhooks/twilio/voice/outbound"))
      .type("form").send({ CallSid: "CA123", sessionId: SESSION_ID, From: "client:not-owner" })
      .expect(403, { error: "Forbidden" });

    expect(service.consumeIntent).toHaveBeenCalledWith(expect.objectContaining({ callerIdentity: "not-owner" }));
  });

  it("fails closed for expired and differently-bound intents", async () => {
    const { app, service } = harness();
    service.consumeIntent.mockRejectedValueOnce(new ComputerCallingError("intent_expired"));
    service.consumeIntent.mockRejectedValueOnce(new ComputerCallingError("intent_already_used"));

    await signed(request(app).post("/webhooks/twilio/voice/outbound"))
      .type("form").send({ CallSid: "CA-expired", sessionId: SESSION_ID, From: "client:owner" })
      .expect(403, { error: "Forbidden" });
    await signed(request(app).post("/webhooks/twilio/voice/outbound"))
      .type("form").send({ CallSid: "CA-other", sessionId: SESSION_ID, From: "client:owner" })
      .expect(403, { error: "Forbidden" });
  });

  it("returns identical TwiML for a same-CallSid retry", async () => {
    const { app } = harness();
    const body = { CallSid: "CA123", sessionId: SESSION_ID, From: "client:owner" };

    const first = await signed(request(app).post("/webhooks/twilio/voice/outbound")).type("form").send(body).expect(200);
    const retry = await signed(request(app).post("/webhooks/twilio/voice/outbound")).type("form").send(body).expect(200);

    expect(retry.text).toBe(first.text);
  });

  it("uses the consumed caller-ID snapshot across retries after configuration changes", async () => {
    const firstConfig = enabledConfig();
    const secondConfig = enabledConfig();
    secondConfig.config.verifiedCallerId = "+15559876543";
    const createOutboundTwiml = vi.fn((input: { callerId: string }) => `<Response>${input.callerId}</Response>`);
    const { app, service, provider } = harness({
      getConfig: vi.fn().mockReturnValueOnce(firstConfig).mockReturnValueOnce(secondConfig),
      provider: {
        validateWebhook: vi.fn().mockReturnValue(true),
        createOutboundTwiml,
        normalizeStatus: vi.fn(),
      },
    });
    service.consumeIntent.mockResolvedValue({
      sessionId: SESSION_ID,
      providerCallSid: "CA123",
      destination: "+15557654321",
      callerId: "+15550001111",
    });
    const body = { CallSid: "CA123", sessionId: SESSION_ID, From: "client:owner" };

    const first = await signed(request(app).post("/webhooks/twilio/voice/outbound")).type("form").send(body).expect(200);
    const retry = await signed(request(app).post("/webhooks/twilio/voice/outbound")).type("form").send(body).expect(200);

    expect(first.text).toBe("<Response>+15550001111</Response>");
    expect(retry.text).toBe(first.text);
    expect(provider.createOutboundTwiml).toHaveBeenNthCalledWith(1, expect.objectContaining({ callerId: "+15550001111" }));
    expect(provider.createOutboundTwiml).toHaveBeenNthCalledWith(2, expect.objectContaining({ callerId: "+15550001111" }));
  });

  it("persists a Number child callback against its bound parent CallSid", async () => {
    const { app, service, provider } = harness();
    const status = {
      CallSid: "CA-child-leg",
      ParentCallSid: "CA-browser-parent",
      CallStatus: "in-progress",
      CallDuration: "12",
    };

    await signed(request(app).post("/webhooks/twilio/voice/status")).type("form").send(status).expect(204);
    await signed(request(app).post("/webhooks/twilio/voice/status")).type("form").send(status).expect(204);

    expect(provider.normalizeStatus).toHaveBeenCalledWith("in-progress");
    expect(service.applyProviderStatus).toHaveBeenNthCalledWith(1, {
      providerCallSid: "CA-browser-parent",
      status: "in-progress",
      occurredAt: new Date("2026-09-01T12:00:00.000Z"),
      durationSeconds: 12,
      errorCode: null,
      errorSummary: null,
    });
    expect(service.applyProviderStatus).toHaveBeenCalledTimes(2);
  });

  it("uses the deployed API prefix in the generated status callback URL", async () => {
    const { app, provider } = harness({ mountPath: "/api" });

    await signed(request(app).post("/api/webhooks/twilio/voice/outbound"))
      .type("form")
      .send({ CallSid: "CA123", sessionId: SESSION_ID, From: "client:owner" })
      .expect(200);

    expect(provider.createOutboundTwiml).toHaveBeenCalledWith(expect.objectContaining({
      statusCallbackUrl: "https://calls.example.test/api/webhooks/twilio/voice/status",
    }));
  });

  it("stores a sanitized unknown-status diagnostic and emits a review warning", async () => {
    const warn = vi.fn();
    const { app, service } = harness({ logger: { warn } });

    await signed(request(app).post("/webhooks/twilio/voice/status"))
      .type("form")
      .send({ CallSid: "CA123", CallStatus: "vendor +15557654321\nnew" })
      .expect(204);

    expect(service.applyProviderStatus).toHaveBeenCalledWith(expect.objectContaining({
      status: "unknown",
      errorSummary: "Unknown provider status: vendor_redacted-phone_new",
    }));
    expect(warn).toHaveBeenCalledWith(
      { providerCallSid: "CA123", providerStatus: "vendor_redacted-phone_new" },
      "Unknown Twilio voice status received",
    );
  });

  it("redacts phone numbers from provider error diagnostics before persistence", async () => {
    const { app, service } = harness();

    await signed(request(app).post("/webhooks/twilio/voice/status"))
      .type("form")
      .send({ CallSid: "CA123", CallStatus: "failed", ErrorMessage: "Could not connect +15557654321" })
      .expect(204);

    expect(service.applyProviderStatus).toHaveBeenCalledWith(expect.objectContaining({
      errorSummary: "Could not connect [redacted-phone]",
    }));
  });
});
