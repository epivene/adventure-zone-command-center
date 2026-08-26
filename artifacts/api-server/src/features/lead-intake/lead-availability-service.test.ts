import { describe, expect, it } from "vitest";
import { LeadAvailabilityService } from "./lead-availability-service";

describe("LeadAvailabilityService", () => {
  it("checks selected calendars, persists evidence, and blocks readiness on ambiguous reservations", async () => {
    const persistence = {
      loadVerifiedLead: async () => ({ id: "row-1", reviewVersion: 4, state: "verified", recipientConfirmed: true, introductionSuitable: true, startDate: "2026-09-10", endDate: "2026-09-12" }),
      selectedCalendars: async () => [{ id: "zone-a", summary: "Adventure Zone", primary: false }],
      save: async (snapshot: unknown) => snapshot,
    };
    const google = { listCalendarEvents: async () => [{
      calendarId: "zone-a", calendarTimeZone: "America/Chicago", id: "event-1", iCalUid: "ical-1",
      summary: "Adventure Zone school event", description: "Could be foam or glow.",
      start: { date: "2026-09-10" }, end: { date: "2026-09-12" }, updated: "2026-08-25T12:00:00Z", recurringEventId: null, originalStartTime: null,
    }] };
    const service = new LeadAvailabilityService({ persistence, google, now: () => new Date("2026-08-25T12:00:00Z") });
    await expect(service.check({ rowId: "row-1", expectedVersion: 4, checkedBy: "owner" })).resolves.toMatchObject({
      rowId: "row-1", reviewVersion: 5, ready: false, proposedWindow: { startDate: "2026-09-08", endDate: "2026-09-13" },
      reservations: [{ calendarEventId: "event-1", confidence: "ambiguous" }],
    });
  });
  it("rejects an out-of-date row before calling Google", async () => {
    const google = { listCalendarEvents: async () => { throw new Error("must not call Google"); } };
    const service = new LeadAvailabilityService({
      persistence: { loadVerifiedLead: async () => ({ id: "row-1", reviewVersion: 5, state: "needs_review" }), selectedCalendars: async () => [], save: async () => undefined },
      google,
    });
    await expect(service.check({ rowId: "row-1", expectedVersion: 4, checkedBy: "owner" })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  });
});