import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync("src/app.ts", "utf8");
const repository = readFileSync(
  "src/features/event-profiles/event-profile-repository.ts",
  "utf8",
);
const calendarImporter = readFileSync(
  "src/features/google-workspace/calendar/operational-calendar-import-service.ts",
  "utf8",
);
const existingProfileUpsert = readFileSync(
  "src/routes/assistant-existing-profile-upsert.ts",
  "utf8",
);
const profileFollowUps = readFileSync(
  "src/routes/assistant-profile-followups.ts",
  "utf8",
);

describe("profiles-first relationship wiring", () => {
  it("mounts safe profile-owned interceptors before the legacy routes", () => {
    expect(app.indexOf("assistantProfileFollowUpsRouter")).toBeLessThan(
      app.indexOf("assistantTodayFollowUpsRouter"),
    );
    expect(app.indexOf("assistantExistingProfileUpsertRouter")).toBeLessThan(
      app.indexOf("assistantImportRouter"),
    );
  });

  it("updates reviewed imports by permanent profile id and refuses ambiguity", () => {
    expect(existingProfileUpsert).toContain("event.id");
    expect(existingProfileUpsert).toContain("updated_existing_profile");
    expect(existingProfileUpsert).toContain("APPROVED_PROFILE_CONTACT_MATCH_AMBIGUOUS");
    expect(existingProfileUpsert).toContain("APPROVED_PROFILE_APPEARANCE_MATCH_AMBIGUOUS");
    expect(existingProfileUpsert).toContain("booking_consolidations retired");
  });

  it("owns one next action across profile, contact, and dated appearance rows", () => {
    expect(profileFollowUps).toContain("from bookings b");
    expect(profileFollowUps).toContain("from organization_contacts oc");
    expect(profileFollowUps).toContain("Replaced by newer profile follow-up");
    expect(profileFollowUps).toContain("bookingId: null");
    expect(profileFollowUps).toContain("contactId: null");
  });

  it("hides retired appearance shells but keeps them in timeline and ACT ownership", () => {
    expect(repository).toContain("booking_consolidations retired");
    expect(repository).toContain("profileBookingOwnershipRows");
    expect(repository).toContain("profileContactOwnershipRows");
    expect(repository).toContain("...contactIds");
    expect(repository).toContain("...bookingIds");
  });

  it("does not offer retired duplicate appearances to calendar matching", () => {
    expect(calendarImporter).toContain("booking_consolidations retired");
    expect(calendarImporter).toContain("retired.source_booking_id = ${bookings.id}");
  });
});
