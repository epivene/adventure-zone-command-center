import { describe, expect, it } from "vitest";

import { readInboundCallingConfig } from "./inbound-calling-config";

const completeEnvironment = {
  NODE_ENV: "test",
  TWILIO_INBOUND_VOICE_ENABLED: "true",
  TWILIO_VOICE_ENABLED: "false",
  TWILIO_ACCOUNT_SID: "AC123",
  TWILIO_API_KEY_SID: "SK123",
  TWILIO_API_KEY_SECRET: "secret",
  TWILIO_AUTH_TOKEN: "auth",
  TWILIO_TWIML_APP_SID: "AP123",
  TWILIO_VERIFIED_CALLER_ID: "+13035550100",
  TWILIO_WEBHOOK_BASE_URL: "http://localhost:3000",
  TWILIO_INBOUND_NUMBER: "+13035550101",
};

describe("readInboundCallingConfig", () => {
  it("keeps inbound enablement independent from outbound enablement", () => {
    const result = readInboundCallingConfig(completeEnvironment);

    expect(result.enabled).toBe(true);
  });

  it("is disabled by default without exposing any configured number", () => {
    const result = readInboundCallingConfig({
      ...completeEnvironment,
      TWILIO_INBOUND_VOICE_ENABLED: undefined,
    });

    expect(result).toEqual({
      enabled: false,
      capability: {
        enabled: false,
        reason: "disabled",
        inboundNumberDisplay: null,
        retentionDays: 30,
        maxSeconds: 120,
      },
    });
  });

  it("fails closed for invalid retention or recording limits", () => {
    const result = readInboundCallingConfig({
      ...completeEnvironment,
      TWILIO_VOICEMAIL_RETENTION_DAYS: "0",
      TWILIO_VOICEMAIL_MAX_SECONDS: "121",
    });

    expect(result.enabled).toBe(false);
    expect(result.capability.reason).toBe("configuration_incomplete");
    expect(result.capability.missing).toEqual([
      "TWILIO_VOICEMAIL_RETENTION_DAYS",
      "TWILIO_VOICEMAIL_MAX_SECONDS",
    ]);
  });
});