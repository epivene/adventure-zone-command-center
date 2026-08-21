import { describe, expect, it } from "vitest";

import {
  applyAutomaticPaperNoteProfileMatch,
  chooseAutomaticPaperNoteProfileMatch,
} from "./paper-note-profile-autolink";

function match(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: "10000000-0000-4000-8000-000000000001",
    organizationLocationId: null,
    name: "4th of July",
    city: "Enoch",
    region: "UT",
    strength: "strong" as const,
    score: 155,
    reasons: ["same phone number", "same city/state", "same contact name"],
    contacts: [],
    organizationPhones: [],
    ...overrides,
  };
}

function review() {
  return {
    event: { name: "4th of July", city: "Enoch", region: "UT", venue: "", eventDateText: "", startsOn: null, endsOn: null, pageYearConfirmed: false },
    activity: { occurredOn: null, method: "call" as const, outcome: "", summary: "" },
    contacts: [{
      key: "contact-0",
      mode: "new_contact" as const,
      selectedContactId: null,
      name: "Deborrah Lay",
      role: null,
      email: null,
      primary: true,
      phones: [{
        key: "phone-0",
        number: "435-890-6349",
        extension: null,
        type: "unknown" as const,
        label: null,
        instructions: null,
        status: "active" as const,
        primary: true,
        crossedOut: false,
        importAsStructuredValue: true,
      }],
    }],
    organizationPhones: [],
    oldReminder: "",
    starredOnPaper: false,
    generalNotes: [],
    destination: null,
    conflicts: {},
    currentFollowUp: { enabled: false, kind: "call", dueOn: null, contactKey: null },
  };
}

describe("chooseAutomaticPaperNoteProfileMatch", () => {
  it("auto-selects one clear strong match with exact identity and corroborating context", () => {
    expect(chooseAutomaticPaperNoteProfileMatch([match() as any])).toMatchObject({
      name: "4th of July",
      organizationId: "10000000-0000-4000-8000-000000000001",
    });
  });

  it("does not auto-select when two strong candidates are too close", () => {
    expect(chooseAutomaticPaperNoteProfileMatch([
      match({ score: 155 }),
      match({ organizationId: "10000000-0000-4000-8000-000000000002", name: "4th of July Celebration", score: 140 }),
    ] as any)).toBeNull();
  });

  it("does not auto-select a phone-only match without corroborating context", () => {
    expect(chooseAutomaticPaperNoteProfileMatch([
      match({ score: 110, reasons: ["same phone number"] }),
    ] as any)).toBeNull();
  });

  it("does not auto-select a name/location-only match without phone or email identity", () => {
    expect(chooseAutomaticPaperNoteProfileMatch([
      match({ score: 85, reasons: ["same event/profile name and city/state"] }),
    ] as any)).toBeNull();
  });

  it("persists the profile destination and a unique saved-contact link together", () => {
    const savedContact = {
      id: "50000000-0000-4000-8000-000000000001",
      name: "Deborrah Lay",
      role: null,
      email: null,
      phones: [{
        id: "60000000-0000-4000-8000-000000000001",
        number: "435-890-6349",
        extension: null,
        type: "unknown" as const,
        label: null,
        instructions: null,
        status: "active" as const,
        primary: true,
      }],
    };
    const result = applyAutomaticPaperNoteProfileMatch(review() as any, [
      match({ contacts: [savedContact] }),
    ] as any);

    expect(result?.destination).toEqual({
      mode: "existing_profile",
      organizationId: "10000000-0000-4000-8000-000000000001",
      organizationLocationId: null,
    });
    expect(result?.contacts[0]).toMatchObject({
      mode: "existing_contact",
      selectedContactId: "50000000-0000-4000-8000-000000000001",
    });
  });
});
