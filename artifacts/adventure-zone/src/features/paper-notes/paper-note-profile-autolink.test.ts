import { describe, expect, it } from "vitest";

import { chooseAutomaticPaperNoteProfileMatch } from "./paper-note-profile-autolink";

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

describe("chooseAutomaticPaperNoteProfileMatch", () => {
  it("auto-selects one clear strong match with exact identity and corroborating context", () => {
    expect(chooseAutomaticPaperNoteProfileMatch([match()])).toMatchObject({
      name: "4th of July",
      organizationId: "10000000-0000-4000-8000-000000000001",
    });
  });

  it("does not auto-select when two strong candidates are too close", () => {
    expect(chooseAutomaticPaperNoteProfileMatch([
      match({ score: 155 }),
      match({ organizationId: "10000000-0000-4000-8000-000000000002", name: "4th of July Celebration", score: 140 }),
    ])).toBeNull();
  });

  it("does not auto-select a phone-only match without corroborating context", () => {
    expect(chooseAutomaticPaperNoteProfileMatch([
      match({ score: 110, reasons: ["same phone number"] }),
    ])).toBeNull();
  });

  it("does not auto-select a name/location-only match without phone or email identity", () => {
    expect(chooseAutomaticPaperNoteProfileMatch([
      match({ score: 85, reasons: ["same event/profile name and city/state"] }),
    ])).toBeNull();
  });
});
