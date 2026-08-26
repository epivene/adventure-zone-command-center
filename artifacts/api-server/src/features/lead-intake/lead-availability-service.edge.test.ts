import { describe, expect, it } from "vitest";
import { LeadAvailabilityService } from "./lead-availability-service";

const lead = { id: "row-1", reviewVersion: 4, state: "verified", recipientConfirmed: true, introductionSuitable: true, startDate: "2026-09-10", endDate: "2026-09-12" };
const persistence = { loadVerifiedLead: async () => lead, selectedCalendars: async () => [{ id: "zone-a", summary: "Adventure Zone", primary: false }], save: async () => ({ reviewVersion: 5 }) };

describe("LeadAvailabilityService edge cases", () => {
  it("deduplicates recurring copies with the same iCal UID and original instance window", async () => {
    const service = new LeadAvailabilityService({ persistence, google: { listCalendarEvents: async () => [
      { calendarId: "zone-a", calendarTimeZone: "America/Chicago", id: "copy-a", iCalUid: "uid-1", recurringEventId: "series", originalStartTime: { date: "2026-09-10" }, summary: "1 Foam Party", description: "", start: { date: "2026-09-10" }, end: { date: "2026-09-12" }, updated: "2026-08-25T12:00:00Z" },
      { calendarId: "zone-b", calendarTimeZone: "America/Chicago", id: "copy-b", iCalUid: "uid-1", recurringEventId: "series", originalStartTime: { date: "2026-09-10" }, summary: "1 Foam Party", description: "", start: { date: "2026-09-10" }, end: { date: "2026-09-12" }, updated: "2026-08-25T12:00:00Z" },
    ] } });
    await expect(service.check({ rowId: "row-1", expectedVersion: 4, checkedBy: "owner" })).resolves.toMatchObject({ reservations: [expect.objectContaining({ calendarEventId: "copy-a" })] });
  });
  it("exposes revoked Google authorization separately from a generic API failure", async () => {
    const service = new LeadAvailabilityService({ persistence, google: { listCalendarEvents: async () => { throw Object.assign(new Error("reauth"), { code: "GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED" }); } } });
    await expect(service.check({ rowId: "row-1", expectedVersion: 4, checkedBy: "owner" })).rejects.toMatchObject({ code: "GOOGLE_REAUTHORIZATION_REQUIRED" });
  });
});