import { describe, expect, it } from "vitest";

import { EnhancedPaperNoteMatchingService } from "./paper-note-enhanced-matching-service";

function review() {
  return {
    event: { name: "Garfield Co Fair", city: "Jordan", region: "MT", venue: "" },
    eventDates: [],
    activity: { rawDateText: null, occurredOn: null, dateSource: "unknown", method: "call", outcome: null, summary: null },
    contacts: [{ key: "c1", name: "Jane Smith", role: null, email: null, phones: [{ number: "435-890-6349", extension: null, type: "mobile", label: null, instructions: null, status: "active", crossedOut: false, importAsStructuredValue: true }], mode: "new_contact", selectedContactId: null, primary: true }],
    organizationPhones: [],
    oldReminder: null,
    starredOnPaper: false,
    generalNotes: [],
    destination: null,
    conflicts: {},
  } as any;
}

describe("EnhancedPaperNoteMatchingService", () => {
  it("ranks a fuzzy county-name match with the same city/state above a generic location match", async () => {
    const repository: any = {
      findCandidates: async () => [
        { organizationId: "generic", organizationLocationId: null, name: "Jordan Community Days", city: "Jordan", region: "MT", exactPhone: false, compatibleExtension: true, exactEmail: false, exactName: false, sameCityRegion: true, venueMatch: false, contactNameMatch: false },
        { organizationId: "garfield", organizationLocationId: null, name: "Garfield County Fair", city: "Jordan", region: "MT", exactPhone: false, compatibleExtension: true, exactEmail: false, exactName: false, sameCityRegion: true, venueMatch: false, contactNameMatch: false },
      ],
      findDetails: async () => new Map(),
    };
    const matches = await new EnhancedPaperNoteMatchingService(repository).match(review());
    expect(matches[0]?.organizationId).toBe("garfield");
    expect(matches[0]?.reasons.join(" ")).toMatch(/similar event\/profile name/i);
  });

  it("surfaces a one-digit saved-phone difference as review evidence rather than auto-correcting", async () => {
    const repository: any = {
      findCandidates: async () => [
        { organizationId: "garfield", organizationLocationId: null, name: "Garfield County Fair", city: "Jordan", region: "MT", exactPhone: false, compatibleExtension: true, exactEmail: false, exactName: false, sameCityRegion: true, venueMatch: false, contactNameMatch: false },
      ],
      findDetails: async () => new Map([["garfield", {
        contacts: [{ id: "saved", name: "Jane Smith", role: null, email: null, phones: [{ id: "p1", number: "435-890-6399", extension: null, type: "mobile", label: null, instructions: null, status: "active", primary: true }] }],
        organizationPhones: [],
      }]]),
    };
    const matches = await new EnhancedPaperNoteMatchingService(repository).match(review());
    expect(matches[0]?.reasons.join(" ")).toMatch(/differs by one digit/i);
  });
});
