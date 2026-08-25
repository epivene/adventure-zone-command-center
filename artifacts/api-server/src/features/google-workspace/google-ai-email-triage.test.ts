import { describe, expect, it, vi } from "vitest";

import { triageGoogleEmailWithAi } from "./google-ai-email-triage";

function client(output: string) {
  return {
    providerName: "Test AI",
    complete: vi.fn(async (_prompt: string) => output),
  };
}

const baseInput = {
  subject: "Payson City Golden Onion Days Payson UT Sept 3-7, 2026",
  from: "Janeen Dean <events@paysonutah.gov>",
  to: "Adventure Zone <theadventurezone12@gmail.com>",
  labels: ["INBOX", "IMPORTANT"],
  bodyText: "We are following up about Golden Onion Days in Payson, Utah.",
  deterministicEvidence: ["weighted_profile_text_ambiguous", "exact_contact_email"],
  matchedContactName: "Janeen Dean",
  candidateProfiles: [
    { id: "golden-onion", name: "Payson Golden Onion Days (Payson) UT" },
    { id: "cinco", name: "Cinco De Mayo / Viva el Mariachi (Payson) UT" },
  ],
};

describe("triageGoogleEmailWithAi", () => {
  it("accepts a high-confidence match only when the profile id is supplied", async () => {
    const ai = client(JSON.stringify({
      decision: "MATCH",
      profileId: "golden-onion",
      confidence: "high",
      reason: "The email explicitly names Golden Onion Days in Payson, UT.",
    }));

    const result = await triageGoogleEmailWithAi({ ...baseInput, ai });

    expect(result).toEqual({
      outcome: "match",
      profileId: "golden-onion",
      confidence: "high",
      reason: "The email explicitly names Golden Onion Days in Payson, UT.",
      providerName: "Test AI",
    });
  });

  it("rejects an invented profile id and leaves the email for review", async () => {
    const ai = client(JSON.stringify({
      decision: "MATCH",
      profileId: "invented-profile",
      confidence: "high",
      reason: "Looks right.",
    }));

    const result = await triageGoogleEmailWithAi({ ...baseInput, ai });

    expect(result.outcome).toBe("review");
    expect(result.profileId).toBeNull();
  });

  it("accepts a high-confidence ignore for clearly unrelated personal/general mail", async () => {
    const ai = client(JSON.stringify({
      decision: "IGNORE",
      profileId: null,
      confidence: "high",
      reason: "Personal payment notice with no event, profile, booking, venue, or business context.",
    }));

    const result = await triageGoogleEmailWithAi({
      ...baseInput,
      subject: "Your payment was successfully processed",
      bodyText: "Payment confirmation for a personal purchase.",
      candidateProfiles: [],
      ai,
    });

    expect(result.outcome).toBe("ignore");
    expect(result.confidence).toBe("high");
  });

  it("does not auto-ignore or auto-match medium-confidence output", async () => {
    const ai = client(JSON.stringify({
      decision: "IGNORE",
      profileId: null,
      confidence: "medium",
      reason: "Probably unrelated.",
    }));

    const result = await triageGoogleEmailWithAi({ ...baseInput, ai });

    expect(result.outcome).toBe("review");
  });

  it("fails closed on malformed output", async () => {
    const result = await triageGoogleEmailWithAi({
      ...baseInput,
      ai: client("not json"),
    });

    expect(result.outcome).toBe("review");
    expect(result.reason).toMatch(/invalid/i);
  });

  it("tells the model that contact ownership is supporting evidence, not authority", async () => {
    const ai = client(JSON.stringify({
      decision: "REVIEW",
      profileId: null,
      confidence: "high",
      reason: "Ambiguous.",
    }));

    await triageGoogleEmailWithAi({ ...baseInput, ai });

    const prompt = ai.complete.mock.calls[0]?.[0] ?? "";
    expect(prompt).toContain("Contact relationships are hints, not authority");
    expect(prompt).toContain("golden-onion");
    expect(prompt).toContain("cinco");
  });
});
