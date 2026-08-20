import { describe, expect, it } from "vitest";

import {
  parsePaperNoteEntryExtraction,
  parsePaperNotePageSegmentation,
} from "./paper-note-extraction-schema";

describe("paper note extraction parsing", () => {
  it("parses fenced segmentation JSON and nulls an out-of-bounds region", () => {
    const result = parsePaperNotePageSegmentation(`\`\`\`json
      {
        "pageHeading":"Phone Calls April 22, 2026",
        "pageActivityDate":"2026-04-22",
        "pageContext":["working call sheet"],
        "roughTranscription":"Phone Calls April 22, 2026...",
        "entries":[
          {"sourceOrder":1,"region":{"x":0.8,"y":0.1,"width":0.4,"height":0.2},"roughText":"Emmett Cherry Festival","mayContinue":false},
          {"sourceOrder":0,"region":{"x":0.1,"y":0.1,"width":0.5,"height":0.2},"roughText":"Hyrum City","mayContinue":false}
        ]
      }
    \`\`\``);

    expect(result.pageHeading).toBe("Phone Calls April 22, 2026");
    expect(result.pageActivityDate).toBe("2026-04-22");
    expect(result.entries.map((entry) => entry.sourceOrder)).toEqual([0, 1]);
    expect(result.entries[1]?.region).toBeNull();
  });

  it("does not turn Monday Call List into a date", () => {
    const result = parsePaperNotePageSegmentation(JSON.stringify({
      pageHeading: "Monday Call List",
      pageActivityDate: null,
      pageContext: [],
      roughTranscription: null,
      entries: [],
    }));
    expect(result.pageHeading).toBe("Monday Call List");
    expect(result.pageActivityDate).toBeNull();
  });

  it("keeps event date, historical activity date, old reminder, star, and extension separate", () => {
    const result = parsePaperNoteEntryExtraction(JSON.stringify({
      transcription: "Emmett Cherry Festival ... call Monday *",
      sourceRegion: null,
      mayContinue: false,
      event: { name: "Emmett Cherry Festival", city: "Emmett", region: "ID", venue: null },
      eventDates: [{ rawText: "June 22", startsOn: "2026-06-22", endsOn: null, derivedFromPageYear: true }],
      activity: {
        rawDateText: "Apr 22",
        occurredOn: "2026-04-22",
        dateSource: "page_heading",
        method: "call",
        outcome: "no room this year",
        summary: "Spoke with Tina; requested info by email"
      },
      contacts: [{
        name: "Tina",
        role: null,
        email: "tina@example.com",
        phones: [{
          number: "2085550142",
          extension: "3115",
          type: "office",
          label: "fair office",
          instructions: "ask for events department",
          crossedOut: false
        }]
      }],
      organizationPhones: [],
      oldReminder: "Call Monday",
      starredOnPaper: true,
      generalNotes: []
    }));

    expect(result.eventDates[0]).toMatchObject({ startsOn: "2026-06-22", derivedFromPageYear: true });
    expect(result.activity.occurredOn).toBe("2026-04-22");
    expect(result.oldReminder).toBe("Call Monday");
    expect(result.starredOnPaper).toBe(true);
    expect(result.contacts[0]?.phones[0]).toMatchObject({ number: "2085550142", extension: "3115" });
    expect(result.warnings.some((warning) => warning.fieldPath === "eventDates.0.startsOn")).toBe(true);
  });

  it("adds blocking warnings for partial phones and review warnings for crossed-out values", () => {
    const result = parsePaperNoteEntryExtraction(JSON.stringify({
      transcription: "phone 208-55? crossed out",
      sourceRegion: null,
      mayContinue: false,
      event: { name: "Example Fair", city: null, region: null, venue: null },
      eventDates: [],
      activity: { rawDateText: null, occurredOn: null, dateSource: "unknown", method: "unknown", outcome: null, summary: null },
      contacts: [],
      organizationPhones: [{
        number: "208-55?",
        extension: null,
        type: "unknown",
        label: null,
        instructions: null,
        crossedOut: true
      }],
      oldReminder: null,
      starredOnPaper: false,
      generalNotes: []
    }));

    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldPath: "organizationPhones.0.number", severity: "blocking" }),
      expect.objectContaining({ fieldPath: "organizationPhones.0", severity: "warning" }),
    ]));
  });

  it("rejects prose instead of trying to repair malformed output", () => {
    expect(() => parsePaperNoteEntryExtraction("Here is what I found: Example Fair"))
      .toThrow("Paper note AI output was not valid JSON");
  });
});
