import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const brief = readFileSync("src/features/assistant/booking-brief.ts", "utf8");
const repository = readFileSync("src/features/assistant/profile-context-repository.ts", "utf8");
const card = readFileSync("../adventure-zone/src/components/assistant/booking-brief-card.tsx", "utf8");

describe("event family assistant overview", () => {
  it("builds a family overview instead of a booking brief", () => {
    expect(brief).toContain("Family overview —");
    expect(brief).toContain("family_members");
    expect(brief).toContain("family_locations");
    expect(brief).toContain("family_types");
    expect(brief).toContain("family_booking_history");
  });

  it("loads aggregate event-family member context instead of one latest booking", () => {
    expect(repository).toContain("memberCount");
    expect(repository).toContain("membersWithBookings");
    expect(repository).toContain("profileTypes");
    expect(repository).toContain("locations");
  });

  it("shows family-specific card language", () => {
    expect(card).toContain("Family Overview");
    expect(card).toContain("There isn’t enough saved family context yet");
  });
});
