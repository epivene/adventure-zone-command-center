import { describe, expect, it } from "vitest";
import { readComputerCallingConfig } from "./computer-calling-config";

const completeEnv = {
  TWILIO_VOICE_ENABLED: "true",
  TWILIO_ACCOUNT_SID: "AC123",
  TWILIO_API_KEY_SID: "SK123",
  TWILIO_API_KEY_SECRET: "secret",
  TWILIO_AUTH_TOKEN: "auth",
  TWILIO_TWIML_APP_SID: "AP123",
  TWILIO_VERIFIED_CALLER_ID: "+15551234567",
  TWILIO_WEBHOOK_BASE_URL: "https://calls.example.test",
};

describe("readComputerCallingConfig", () => {
  it("fails closed when voice calling is not enabled", () => {
    expect(readComputerCallingConfig({})).toEqual({
      enabled: false,
      capability: {
        enabled: false,
        reason: "disabled",
        callerIdDisplay: null,
      },
    });
  });

  it("fails closed when voice calling is explicitly disabled", () => {
    expect(readComputerCallingConfig({ ...completeEnv, TWILIO_VOICE_ENABLED: "false" })).toEqual({
      enabled: false,
      capability: {
        enabled: false,
        reason: "disabled",
        callerIdDisplay: null,
      },
    });
  });

  it("fails closed when one required credential is missing", () => {
    const { TWILIO_WEBHOOK_BASE_URL: _webhookBaseUrl, ...incompleteEnv } = completeEnv;

    expect(readComputerCallingConfig(incompleteEnv)).toEqual({
      enabled: false,
      capability: {
        enabled: false,
        reason: "configuration_incomplete",
        callerIdDisplay: null,
      },
    });
  });

  it("fails closed for a non-HTTPS webhook base URL", () => {
    expect(readComputerCallingConfig({
      ...completeEnv,
      TWILIO_WEBHOOK_BASE_URL: "http://calls.example.test",
    })).toEqual({
      enabled: false,
      capability: {
        enabled: false,
        reason: "configuration_incomplete",
        callerIdDisplay: null,
      },
    });
  });

  it("allows an HTTP localhost webhook base URL only in test environments", () => {
    expect(readComputerCallingConfig({
      ...completeEnv,
      NODE_ENV: "test",
      TWILIO_WEBHOOK_BASE_URL: "http://localhost:3000",
    })).toMatchObject({
      enabled: true,
      capability: {
        enabled: true,
        reason: "available",
        callerIdDisplay: "+15551234567",
      },
    });
  });

  it("fails closed for an invalid E.164 caller ID", () => {
    expect(readComputerCallingConfig({
      ...completeEnv,
      TWILIO_VERIFIED_CALLER_ID: "555-123-4567",
    })).toEqual({
      enabled: false,
      capability: {
        enabled: false,
        reason: "configuration_incomplete",
        callerIdDisplay: null,
      },
    });
  });

  it("returns complete configuration and a secret-free public capability", () => {
    const result = readComputerCallingConfig(completeEnv);

    expect(result).toEqual({
      enabled: true,
      config: {
        accountSid: "AC123",
        apiKeySid: "SK123",
        apiKeySecret: "secret",
        authToken: "auth",
        twimlAppSid: "AP123",
        verifiedCallerId: "+15551234567",
        webhookBaseUrl: "https://calls.example.test",
      },
      capability: {
        enabled: true,
        reason: "available",
        callerIdDisplay: "+15551234567",
      },
    });
  });
});
