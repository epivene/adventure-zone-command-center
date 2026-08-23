import { describe, expect, it } from "vitest";

import type { PaperNoteExtraction, PaperNotePageSegmentation } from "./paper-note-extraction-schema";
import {
  mergePaperNoteContinuationHints,
  mergeCriticalPaperNoteRead,
  paperNoteNameSimilarity,
  shouldVerifyCriticalPaperNoteDetails,
} from "./paper-note-reading-improvements";

function extraction(): PaperNoteExtraction {
  return {
    source: "provider",
    transcription: "Garfield Co Fair Jane 435-890-6349",
    sourceRegion: null,
    mayContinue: false,
    event: { name: "Garfield Co Fair", city: "Jordan", region: "MT", venue: null },
    eventDates: [],
    activity: { rawDateText: null, occurredOn: null, dateSource: "unknown", method: "call", outcome: null, summary: null },
    contacts: [{ name: null, role: null, email: null, phones: [{ number: "435-890-6349", extension: null, type: "mobile", label: null, instructions: null, crossedOut: false }] }],
    organizationPhones: [],
    oldReminder: null,
    starredOnPaper: false,
    generalNotes: [],
    warnings: [],
  };
}

describe("paper note reading improvements", () => {
  it("merges vertically adjacent continuation chunks in the same column", () => {
    const input: PaperNotePageSegmentation = {
      pageHeading: null,
      pageActivityDate: null,
      pageContext: [],
      roughTranscription: null,
      entries: [
        { sourceOrder: 0, region: { x: 0.08, y: 0.10, width: 0.42, height: 0.10 }, roughText: "Garfield County Fair", mayContinue: true },
        { sourceOrder: 1, region: { x: 0.09, y: 0.205, width: 0.40, height: 0.08 }, roughText: "Jane - 435-890-6399 - call next year", mayContinue: false },
        { sourceOrder: 2, region: { x: 0.58, y: 0.12, width: 0.34, height: 0.12 }, roughText: "Another Festival", mayContinue: false },
      ],
    };

    const merged = mergePaperNoteContinuationHints(input);
    expect(merged.entries).toHaveLength(2);
    expect(merged.entries[0]?.roughText).toContain("Garfield County Fair");
    expect(merged.entries[0]?.roughText).toContain("435-890-6399");
    expect(merged.entries[0]?.region?.height).toBeGreaterThan(0.18);
    expect(merged.entries[1]?.roughText).toBe("Another Festival");
  });

  it("does not merge close chunks from different columns", () => {
    const input: PaperNotePageSegmentation = {
      pageHeading: null, pageActivityDate: null, pageContext: [], roughTranscription: null,
      entries: [
        { sourceOrder: 0, region: { x: 0.05, y: 0.1, width: 0.35, height: 0.1 }, roughText: "Left Fair", mayContinue: true },
        { sourceOrder: 1, region: { x: 0.58, y: 0.19, width: 0.35, height: 0.1 }, roughText: "Right Fair", mayContinue: false },
      ],
    };
    expect(mergePaperNoteContinuationHints(input).entries).toHaveLength(2);
  });

  it("requests a critical reread when a name is missing or a phone was read", () => {
    expect(shouldVerifyCriticalPaperNoteDetails(extraction())).toBe(true);
    const noPhone = extraction();
    noPhone.contacts = [{ ...noPhone.contacts[0]!, name: "Jane", phones: [] }];
    expect(shouldVerifyCriticalPaperNoteDetails(noPhone)).toBe(false);
  });

  it("fills missing names from the independent reread and warns on a digit disagreement", () => {
    const first = extraction();
    const second = extraction();
    second.contacts[0]!.name = "Jane Smith";
    second.contacts[0]!.phones[0]!.number = "435-890-6399";

    const merged = mergeCriticalPaperNoteRead(first, second);
    expect(merged.contacts[0]?.name).toBe("Jane Smith");
    expect(merged.contacts[0]?.phones[0]?.number).toBe("435-890-6349");
    expect(merged.warnings.some((warning) => /two ai reads disagree/i.test(warning.message))).toBe(true);
  });

  it("treats common event-name wording variants as strongly similar", () => {
    expect(paperNoteNameSimilarity("Garfield Co Fair", "Garfield County Fair")).toBeGreaterThanOrEqual(0.8);
    expect(paperNoteNameSimilarity("Northwest MT Fair Rodeo", "Northwest Montana Fair & Rodeo")).toBeGreaterThanOrEqual(0.65);
    expect(paperNoteNameSimilarity("Harvest Days", "Water Lantern Festival")).toBeLessThan(0.4);
  });
});
