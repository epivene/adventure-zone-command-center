import { describe, expect, it, vi } from "vitest";

import type { AiCompletionClient } from "@/features/ai-suggestions/ai-client";
import { DefaultPaperNoteExtractionProvider } from "./paper-note-extraction-provider";

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
    expect(call?.maxTokens).toBe(4096);
    expect(call?.prompt).toContain("Page headings are context, not event entries");
    expect(call?.prompt).toContain("never invent missing digits or letters");
    expect(call?.prompt).toContain("old reminder");
    expect(call?.prompt).toContain("star");
    expect(call?.prompt).toContain("crossed-out");
    expect(call?.prompt).toContain("June 3");
    expect(call?.prompt).toContain("keep that month/day text in pageHeading");
  });

  it("uses valid enum examples and keeps communication dates separate from event dates", async () => {
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
    expect(call?.prompt).toContain('"dateSource":"unknown"');
    expect(call?.prompt).toContain('"method":"unknown"');
    expect(call?.prompt).toContain('"type":"unknown"');
    expect(call?.prompt).not.toContain('"dateSource":"entry|page_heading|unknown"');
    expect(call?.prompt).not.toContain('"type":"mobile|office|alternate|unknown"');
    expect(call?.prompt).toContain("Allowed dateSource values");
    expect(call?.prompt).toContain("Allowed phone type values");
    expect(call?.prompt).toContain('Future-action wording such as "Send email"');
    expect(call?.prompt).toContain("belongs in oldReminder");
    expect(call?.prompt).toContain("Do not set activity.method from a future instruction");
    expect(call?.prompt).toContain("already happened");
    expect(call?.prompt).toContain("These paper sheets are primarily phone-call records");
    expect(call?.prompt).toContain("default activity.method to call");
  });

  it("accepts harmless wrapper text around one complete JSON object", async () => {
    const ai = client([`Here is the JSON you requested:\n${segmentation}\nDone.`]);
    const provider = new DefaultPaperNoteExtractionProvider(async () => ai);

    await expect(provider.segmentPage({ bytes: new Uint8Array([1]), mimeType: "image/jpeg" }))
      .resolves.toMatchObject({ pageHeading: "Monday Call List" });
    expect(ai.completeImage).toHaveBeenCalledTimes(1);
  });

  it("retries malformed output once with an explicit corrective JSON instruction", async () => {
    const ai = client(["not json", segmentation]);
    const provider = new DefaultPaperNoteExtractionProvider(async () => ai);

    await expect(provider.segmentPage({ bytes: new Uint8Array([1]), mimeType: "image/jpeg" }))
      .resolves.toMatchObject({ pageHeading: "Monday Call List" });
    expect(ai.completeImage).toHaveBeenCalledTimes(2);
    const firstPrompt = vi.mocked(ai.completeImage!).mock.calls[0]?.[0].prompt ?? "";
    const retryPrompt = vi.mocked(ai.completeImage!).mock.calls[1]?.[0].prompt ?? "";
    expect(retryPrompt).not.toBe(firstPrompt);
    expect(retryPrompt).toContain("previous response was invalid or truncated");
    expect(retryPrompt).toContain("compact JSON only");
  });

  it("reports malformed output after the one bounded retry", async () => {
    const ai = client(["not json", "still not json"]);
    const provider = new DefaultPaperNoteExtractionProvider(async () => ai);

    await expect(provider.segmentPage({ bytes: new Uint8Array([1]), mimeType: "image/jpeg" }))
      .rejects.toMatchObject({ code: "MALFORMED_OUTPUT" });
  });

  it("reports unavailable configuration separately", async () => {
    const unavailable = new Error("missing");
    (unavailable as NodeJS.ErrnoException).code = "NO_AI_PROVIDER_CONFIGURED";
    const provider = new DefaultPaperNoteExtractionProvider(async () => { throw unavailable; });

    await expect(provider.segmentPage({ bytes: new Uint8Array([1]), mimeType: "image/jpeg" }))
      .rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  });
});
