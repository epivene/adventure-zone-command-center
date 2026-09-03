import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createInboundComputerCallingRouter } from "./inbound-computer-calling";

const inboundSession = {
  id: "33b5d08e-1e72-4b16-808f-aaa79ac85fd6",
  ownerId: "owner",
  providerParentCallSid: "CA12345678",
  status: "ringing",
  answeredAt: null,
  caller: {
    callerNumber: "+13035550101",
    organizationId: null,
    contactId: null,
    phoneId: null,
  },
};

describe("inbound computer calling controls", () => {
  it("redirects the live parent call to voicemail when the user chooses voicemail", async () => {
    const redirects: Array<{ callSid: string; twiml: string }> = [];
    const provider = {
      validateWebhook: vi.fn(),
      createBrowserToken: vi.fn(),
      createClientDialTwiml: vi.fn(),
      createVoicemailTwiml: vi.fn().mockReturnValue("<Response><Say>Leave a message.</Say></Response>"),
      createUnavailableTwiml: vi.fn(),
      redirectCallToVoicemail: async (input: { callSid: string; twiml: string }) => {
        redirects.push(input);
      },
      getRecordingMedia: vi.fn(),
      deleteRecording: vi.fn(),
    };
    const app = express();
    app.use(express.json());
    app.use("/api", createInboundComputerCallingRouter({
      service: {} as never,
      getConfig: () => ({
        enabled: true,
        config: {
          inboundNumber: "+13035550100",
          retentionDays: 30,
          maxSeconds: 120,
          voiceConfig: {
            accountSid: "AC00000000000000000000000000000000",
            apiKeySid: "SK00000000000000000000000000000000",
            apiKeySecret: "secret",
            authToken: "auth-token",
            twimlAppSid: "AP00000000000000000000000000000000",
            verifiedCallerId: "+13035550100",
            webhookBaseUrl: "https://calls.example.test",
          },
        },
        capability: {
          enabled: true,
          reason: "available",
          inboundNumberDisplay: "+1••••0100",
          retentionDays: 30,
          maxSeconds: 120,
        },
      }),
      isAssistedCallingEnabled: () => true,
      providerForConfig: () => provider,
      calls: {
        voicemail: vi.fn().mockResolvedValue(inboundSession),
      } as never,
    }));

    await request(app)
      .post(`/api/calls/incoming/sessions/${inboundSession.id}/voicemail`)
      .expect(204);

    expect(redirects).toEqual([{
      callSid: "CA12345678",
      twiml: "<Response><Say>Leave a message.</Say></Response>",
    }]);
  });
});
