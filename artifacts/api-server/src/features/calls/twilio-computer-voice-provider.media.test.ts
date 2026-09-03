import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import { TwilioComputerVoiceProvider } from "./twilio-computer-voice-provider";

describe("TwilioComputerVoiceProvider recording media", () => {
  it("downloads authenticated recording bytes as a readable audio stream", async () => {
    const audio = Uint8Array.from([73, 68, 51, 4, 0, 0]);
    const fetcher = vi.fn().mockResolvedValue(new Response(audio, {
      status: 200,
      headers: { "content-type": "audio/mpeg" },
    }));
    const provider = new TwilioComputerVoiceProvider({
      accountSid: "AC00000000000000000000000000000000",
      apiKeySid: "SK00000000000000000000000000000000",
      apiKeySecret: "secret",
      authToken: "auth-token",
      twimlAppSid: "AP00000000000000000000000000000000",
      verifiedCallerId: "+13035550100",
      webhookBaseUrl: "https://calls.example.test",
    }, fetcher);

    const media = await provider.getRecordingMedia("RE123");
    const chunks: Buffer[] = [];
    for await (const chunk of media.body as Readable) chunks.push(Buffer.from(chunk));

    expect(Buffer.concat(chunks)).toEqual(Buffer.from(audio));
    expect(media.contentType).toBe("audio/mpeg");
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.twilio.com/2010-04-01/Accounts/AC00000000000000000000000000000000/Recordings/RE123.mp3",
      expect.objectContaining({
        headers: {
          Authorization: `Basic ${Buffer.from("SK00000000000000000000000000000000:secret").toString("base64")}`,
        },
      }),
    );
  });

  it("rejects a failed recording download instead of returning an error document as audio", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 }));
    const provider = new TwilioComputerVoiceProvider({
      accountSid: "AC00000000000000000000000000000000",
      apiKeySid: "SK00000000000000000000000000000000",
      apiKeySecret: "secret",
      authToken: "auth-token",
      twimlAppSid: "AP00000000000000000000000000000000",
      verifiedCallerId: "+13035550100",
      webhookBaseUrl: "https://calls.example.test",
    }, fetcher);

    await expect(provider.getRecordingMedia("RE123"))
      .rejects.toThrow("Twilio recording download failed with status 401");
  });
});
