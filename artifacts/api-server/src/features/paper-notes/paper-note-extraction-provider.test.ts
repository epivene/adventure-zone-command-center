import { describe, expect, it, vi } from "vitest";

import type { AiCompletionClient } from "@/features/ai-suggestions/ai-client";
import {
  DefaultPaperNoteExtractionProvider,
  PaperNoteProviderError,
} from "./paper-note-extraction-provider";

function client(outputs: string[]): AiCompletionClient {
  const completeImage = vi.fn(async () => outputs.shift() ?? "{}");
  return {
    providerName: "Fake vision",
    complete: vi.fn(async () => "{}"),
    completeImage,
  };
}

const segmentation = JSON.stringify({
  pageHeading: "Monday Call List",
  pageActivityDate: null,
  pageContext: [],
  roughTranscription: "Monday Call List",
  entries: [],
});

const entry = JSON.stringify({
  transcription: "Example Fair",
  sourceRegion: null,
  mayContinue: false,
  event: { name: "Example Fair", city: null, region: null, venue: null },
  eventDates: [],
  activity: { rawDateText: null, occurredOn: null, dateSource: "unknown", method: "unknown", outcome: null, summary: null },
  contacts: [],
  organizationPhones: [],
  oldReminder: null,
  starredOnPaper: false,
  generalNotes: [],
});

describe("DefaultPaperNoteExtractionProvider", () => {
  it("puts the approved interpretation rules in the segmentation prompt", async () => {
    const ai = client([segmentation]);
    const provider = new DefaultPaperNoteExtractionProvider(async () => ai);

    await provider.segmentPage({ bytes: new Uint8Array([1, 2]), mimeType: "image/jpeg" });

    const call = vi.mocked(ai.completeImage!).mock.calls[0]?.[0];
    expect(call?.maxTokens).toBe(2400);
    expect(call?.prompt).toContain("Page headings are context, not event entries");
    expect(call?.prompt).toContain("never invent missing digits or letters");
    expect(call?.prompt).toContain("old reminder");
    expect(call?.prompt).toContain("star");
    expect(call?.prompt).toContain("crossed-out");
  });

  it("uses the entry budget and keeps communication dates separate from event dates", async () => {
    const ai = client([entry]);
    const provider = new DefaultPaperNoteExtractionProvider(async () => ai);

    await provider.extractEntry({
      bytes: new Uint8Array([1, 2]),
      mimeType: "image/jpeg",
      pageContext: { pageHeading: "Phone Calls April 22, 2026", pageActivityDate: "2026-04-22" },
    });

    const call = vi.mocked(ai.completeImage!).mock.calls[0]?.[0];
    expect(call?.maxTokens).toBe(1800);
    expect(call?.prompt).toContain("separate event dates from communication dates");
    expect(call?.prompt).toContain("extension");
    expect(call?.prompt).toContain("Starred on original paper");
  });

  it("retries malformed output once and then succeeds", async () => {
    const ai = client(["not json", segmentation]);
    const provider = new DefaultPaperNoteExtractionProvider(async () => ai);

    await expect(provider.segmentPage({ bytes: new Uint8Array([1]), mimeType: "image/jpeg" }))
      .resolves.toMatchObject({ pageHeading: "Monday Call List" });
    expect(ai.completeImage).toHaveBeenCalledTimes(2);
  });

  it("reports malformed output after the one bounded retry", async () => {
    const ai = client(["not json", "still not json"]);
    const provider = new DefaultPaperNoteExtractionProvider(async () => ai);

    await expect(provider.segmentPage({ bytes: new Uint8Array([1]), mimeType: "image/jpeg" }))
      .rejects.toMatchObject<Partial<PaperNoteProviderError>>({ code: "MALFORMED_OUTPUT" });
  });

  it("reports unavailable configuration separately", async () => {
    const unavailable = new Error("missing");
    (unavailable as NodeJS.ErrnoException).code = "NO_AI_PROVIDER_CONFIGURED";
    const provider = new DefaultPaperNoteExtractionProvider(async () => { throw unavailable; });

    await expect(provider.segmentPage({ bytes: new Uint8Array([1]), mimeType: "image/jpeg" }))
      .rejects.toMatchObject<Partial<PaperNoteProviderError>>({ code: "PROVIDER_UNAVAILABLE" });
  });
});
