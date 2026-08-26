import { describe, expect, it } from "vitest";
import { LeadAvailabilityService } from "./lead-availability-service";

const lead = { id: "row-1", reviewVersion: 4, state: "verified", organizationId: "org-1", recipientEmail: "events@example.com", recipientConfirmed: true, introductionSuitable: true, startDate: "2026-09-10", endDate: "2026-09-12" };
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
  it.each(["invalid JSON", "empty object", "non-array items", "missing active-event ID"])("does not save availability when Google returns %s evidence", async () => {
    let saved = false;
    const service = new LeadAvailabilityService({ persistence: { ...persistence, save: async () => { saved = true; return { reviewVersion: 5 }; } }, google: { listCalendarEvents: async () => { throw Object.assign(new Error("invalid Calendar event list"), { code: "GOOGLE_WORKSPACE_CALENDAR_EVENT_RESPONSE_INVALID" }); } } });
    await expect(service.check({ rowId: "row-1", expectedVersion: 4, checkedBy: "owner" })).rejects.toMatchObject({ code: "GOOGLE_CALENDAR_UNAVAILABLE" });
    expect(saved).toBe(false);
  });
  it.each([
    ["quantity", { summary: "3 Foam Party" }],
    ["conditional quantity", { summary: "maybe 1 Foam Party" }],
    ["stored window", { start: { date: "2026-09-11" }, end: { date: "2026-09-13" } }],
    ["updated timestamp", { updated: "2026-08-26T12:00:00Z" }],
  ])("fails closed when same-instance copies disagree on %s", async (_name, change) => {
    let snapshot: any;
    const copies = [
      { calendarId: "zone-a", calendarTimeZone: "America/Chicago", id: "copy-a", iCalUid: "uid-1", recurringEventId: "series", originalStartTime: { date: "2026-09-10" }, summary: "1 Foam Party", description: "", start: { date: "2026-09-10" }, end: { date: "2026-09-12" }, updated: "2026-08-25T12:00:00Z" },
      { calendarId: "zone-b", calendarTimeZone: "America/Chicago", id: "copy-b", iCalUid: "uid-1", recurringEventId: "series", originalStartTime: { date: "2026-09-10" }, summary: "1 Foam Party", description: "", start: { date: "2026-09-10" }, end: { date: "2026-09-12" }, updated: "2026-08-25T12:00:00Z", ...change },
    ];
    const service = new LeadAvailabilityService({ persistence: { ...persistence, save: async (value: any) => { snapshot = value; return { reviewVersion: 5 }; } }, google: { listCalendarEvents: async () => copies } });
    await expect(service.check({ rowId: "row-1", expectedVersion: 4, checkedBy: "owner" })).resolves.toMatchObject({ ready: false, reservations: [expect.objectContaining({ confidence: "ambiguous", packages: [] })] });
    expect(snapshot.sourceEvents).toEqual(expect.arrayContaining([expect.objectContaining({ eventId: "copy-a", classification: expect.any(Object) }), expect.objectContaining({ eventId: "copy-b", classification: expect.any(Object) })]));
  });
  it("collapses matching same-instance copies only after every copy agrees", async () => {
    let snapshot: any;
    const service = new LeadAvailabilityService({ persistence: { ...persistence, save: async (value: any) => { snapshot = value; return { reviewVersion: 5 }; } }, google: { listCalendarEvents: async () => [
      { calendarId: "zone-a", calendarTimeZone: "America/Chicago", id: "copy-a", iCalUid: "uid-1", recurringEventId: "series", originalStartTime: { date: "2026-09-10" }, summary: "1 Foam Party", description: "", start: { date: "2026-09-10" }, end: { date: "2026-09-12" }, updated: "2026-08-25T12:00:00Z" },
      { calendarId: "zone-b", calendarTimeZone: "America/Chicago", id: "copy-b", iCalUid: "uid-1", recurringEventId: "series", originalStartTime: { date: "2026-09-10" }, summary: "1 Foam Party", description: "", start: { date: "2026-09-10" }, end: { date: "2026-09-12" }, updated: "2026-08-25T12:00:00Z" },
    ] } });
    await expect(service.check({ rowId: "row-1", expectedVersion: 4, checkedBy: "owner" })).resolves.toMatchObject({ ready: true, reservations: [expect.objectContaining({ confidence: "explicit", packages: [{ packageKey: "foam-party", quantity: 1 }] })] });
    expect(snapshot.sourceEvents).toHaveLength(2);
  });
});
