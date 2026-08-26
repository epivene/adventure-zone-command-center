import { describe, expect, it } from "vitest";
import { LeadAvailabilityService } from "./lead-availability-service";

const lead = { id: "row-1", reviewVersion: 4, state: "verified", organizationId: "org-1", recipientEmail: "events@example.com", recipientConfirmed: true, introductionSuitable: true, startDate: "2026-09-10", endDate: "2026-09-12" };
describe("LeadAvailabilityService review regressions", () => {
  it("queries a timezone-safe interval while retaining only stored-window overlaps", async () => {
    const calls: any[] = [];
    const service = new LeadAvailabilityService({
      persistence: { loadVerifiedLead: async () => lead, selectedCalendars: async () => [{ id: "zone-a", summary: "Adventure Zone", primary: false }], save: async () => ({ reviewVersion: 5 }) },
      google: { listCalendarEvents: async (input: any) => { calls.push(input); return [{ calendarId: "zone-a", calendarTimeZone: "America/Los_Angeles", id: "e1", iCalUid: null, summary: "2 Foam Party", description: "", start: { date: "2026-09-08" }, end: { date: "2026-09-14" }, updated: "2026-08-25T12:00:00Z", recurringEventId: null, originalStartTime: null }]; } },
    });
    await expect(service.check({ rowId: "row-1", expectedVersion: 4, checkedBy: "owner" })).resolves.toMatchObject({ reservations: [{ occupiedWindow: { startDate: "2026-09-08", endDate: "2026-09-13" } }] });
    expect(calls[0].timeMin).toBe("2026-09-07T00:00:00.000Z");
    expect(calls[0].timeMax).toBe("2026-09-15T00:00:00.000Z");
  });
});