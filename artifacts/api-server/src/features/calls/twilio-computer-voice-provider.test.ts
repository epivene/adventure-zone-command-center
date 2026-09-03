import { createHmac } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ComputerCallStatus } from "./computer-calling-types";
import type { ComputerVoiceProvider } from "./computer-voice-provider";
import { TwilioComputerVoiceProvider } from "./twilio-computer-voice-provider";

const config = {
  accountSid: "AC00000000000000000000000000000000",
  apiKeySid: "SK00000000000000000000000000000000",
  apiKeySecret: "api-key-secret",
  authToken: "auth-token",
  twimlAppSid: "AP00000000000000000000000000000000",
  verifiedCallerId: "+15557654321",
  webhookBaseUrl: "https://calls.example.test",
};

function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("Expected a JWT payload");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
}

function twilioSignature(url: string, params: Record<string, string>): string {
  const data = `${url}${Object.keys(params).sort().map((key) => `${key}${params[key]}`).join("")}`;
  return createHmac("sha1", config.authToken).update(data, "utf8").digest("base64");
}

function provider(): ComputerVoiceProvider {
  return new TwilioComputerVoiceProvider(config);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("TwilioComputerVoiceProvider", () => {
  it("issues a 300-second browser Voice token for the owner and configured TwiML application", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-02T12:00:00.000Z"));

    const token = provider().createBrowserToken({ identity: "owner", ttlSeconds: 300 });
    const payload = decodeJwtPayload(token);

    expect(payload).toMatchObject({
      iss: config.apiKeySid,
      sub: config.accountSid,
      iat: 1_788_350_400,
      exp: 1_788_350_700,
      grants: {
        identity: "owner",
        voice: {
          outgoing: { application_sid: config.twimlAppSid },
        },
      },
    });
  });

  it("validates exactly the Twilio-signed webhook URL and parameters", () => {
    const url = "https://calls.example.test/api/computer-calls/status";
    const params = { CallSid: "CA123", CallStatus: "ringing", Digits: "5" };

    expect(provider().validateWebhook({
      signature: twilioSignature(url, params),
      url,
      params,
    })).toBe(true);
    expect(provider().validateWebhook({
      signature: twilioSignature(url, params),
      url: `${url}?altered=true`,
      params,
    })).toBe(false);
    expect(provider().validateWebhook({
      signature: "not-a-twilio-signature",
      url,
      params,
    })).toBe(false);
  });

  it("creates no-recording outbound TwiML with the verified caller ID, DTMF Number, and callbacks", () => {
    const twiml = provider().createOutboundTwiml({
      destination: "+15551234567",
      callerId: config.verifiedCallerId,
      statusCallbackUrl: "https://calls.example.test/api/computer-calls/status?session=abc",
    });

    expect(twiml).toMatch(/<Dial\b[^>]*answerOnBridge="true"/);
    expect(twiml).toMatch(/<Dial\b[^>]*record="do-not-record"/);
    expect(twiml).toMatch(/<Dial\b[^>]*timeout="30"/);
    expect(twiml).toContain('callerId="+15557654321"');
    expect(twiml).toContain('<Number statusCallback="https://calls.example.test/api/computer-calls/status?session=abc"');
    expect(twiml).toContain('statusCallbackEvent="initiated ringing answered completed"');
    expect(twiml).toContain(">+15551234567</Number>");
    expect(twiml).not.toContain("<Record");
  });

  it("XML-escapes outbound TwiML values", () => {
    const twiml = provider().createOutboundTwiml({
      destination: "+15551234567<&",
      callerId: "+15557654321\"&",
      statusCallbackUrl: "https://calls.example.test/status?value=<&\"'",
    });

    expect(twiml).toContain("+15551234567&lt;&amp;</Number>");
    expect(twiml).toContain('callerId="+15557654321&quot;&amp;"');
    expect(twiml).toContain("value=&lt;&amp;&quot;'");
  });

  it("passes the inbound session ID to the browser call", () => {
    const twiml = new TwilioComputerVoiceProvider(config).createClientDialTwiml({
      identity: "inbound_browser",
      sessionId: "session-123",
      actionUrl: "https://calls.example.test/inbound/dial-result",
      statusCallbackUrl: "https://calls.example.test/inbound/status",
    });

    expect(twiml).toContain(
      '<Parameter name="inboundSessionId" value="session-123"/>',
    );
  });

  it.each<[string, ComputerCallStatus]>([
    ["initiated", "queued"],
    ["queued", "queued"],
    ["ringing", "ringing"],
    ["in-progress", "in-progress"],
    ["completed", "completed"],
    ["busy", "busy"],
    ["no-answer", "no-answer"],
    ["canceled", "canceled"],
    ["failed", "failed"],
    ["future-twilio-status", "unknown"],
  ])("normalizes provider status %s to %s", (status, expected) => {
    expect(provider().normalizeStatus(status)).toBe(expected);
  });
});
