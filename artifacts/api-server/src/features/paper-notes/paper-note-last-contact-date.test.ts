import { describe, expect, it, vi } from "vitest";

import type { AiCompletionClient } from "@/features/ai-suggestions/ai-client";
import { DefaultPaperNoteExtractionProvider } from "./paper-note-extraction-provider";

const entry = JSON.stringify({
  transcription: "Example Fair",
  sourceRegion: null,
  mayContinue: false,
  event: { name: "Example Fair", city: null, region: null, venue: null },
  eventDates: [],
  activity: { rawDateText: null, occurredOn: "2025-07-14", dateSource: "page_heading", method: "unknown", outcome: null, summary: null },
  contacts: [],
  organizationPhones: [],
  oldReminder: null,
  starredOnPaper: false,
  generalNotes: [],
});

describe("paper note page contact date rule", () => {
  it("treats the date at the top of the paper as the entries' last-contact date, never the event date", async () => {
    const completeImage = vi.fn(async (_input: Parameters<NonNullable<AiCompletionClient["completeImage"]>>[0]) => entry);
    const client: AiCompletionClient = {
      providerName: "Fake vision",
      complete: vi.fn(async () => "{}"),
      completeImage,
    };
    const provider = new DefaultPaperNoteExtractionProvider(async () => client);

    await provider.extractEntry({
      bytes: new Uint8Array([1]),
      mimeType: "image/jpeg",
      pageContext: { pageHeading: "July 14, 2025", pageActivityDate: "2025-07-14" },
    });

    const prompt = vi.mocked(completeImage).mock.calls[0]?.[0].prompt ?? "";
    expect(prompt).toContain("last contact date");
    expect(prompt).toContain("activity.occurredOn");
    expect(prompt).toContain("entry-specific contact date");
    expect(prompt).toContain("never an event date");
  });
});
