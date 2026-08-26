import { describe, expect, it, vi } from "vitest";

import { LeadAvailabilityService } from "./lead-availability-service";

describe("LeadAvailabilityService package capacity", () => {
  it("classifies Calendar package usage and persists the calculated availability", async () => {
    const save = vi.fn().mockResolvedValue({ reviewVersion: 5 });
    const service = new LeadAvailabilityService({
      persistence: {
        loadVerifiedLead: async () => ({
          id: "row-1", reviewVersion: 4, state: "verified",
          organizationId: "org-1", recipientEmail: "events@example.com",
          recipientConfirmed: true, introductionSuitable: true,
          startDate: "2026-09-10", endDate: "2026-09-12",
        }),
        selectedCalendars: async () => [{ id: "zone-a", summary: "Zone A", primary: false }],
        packageAvailabilityTemplates: async () => [
          { code: "adventure_zone", name: "Adventure Zone", normalCapacity: 5, temporaryUnavailableQuantity: 1 },
          { code: "pirates_rebellion", name: "Pirate's Rebellion", normalCapacity: 3, temporaryUnavailableQuantity: 0 },
        ],
        save,
      },
      google: { listCalendarEvents: async () => [{
        calendarId: "zone-a", calendarTimeZone: "America/Chicago", id: "event-1", iCalUid: "ical-1",
        summary: "2 Adventure Zone", description: "1 Pirate's Rebellion",
        start: { date: "2026-09-10" }, end: { date: "2026-09-12" },
        updated: "2026-08-25T12:00:00Z", recurringEventId: null, originalStartTime: null,
      }] },
      now: () => new Date("2026-08-25T12:00:00Z"),
    });

    await expect(service.check({ rowId: "row-1", expectedVersion: 4, checkedBy: "owner" }))
      .resolves.toMatchObject({
        ready: true,
        packageAvailability: {
          status: "resolved",
          packages: [
            { packageKey: "adventure_zone", bookedQuantity: 2, availableQuantity: 2 },
            { packageKey: "pirates_rebellion", bookedQuantity: 1, availableQuantity: 2 },
          ],
        },
      });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      packageAvailability: expect.objectContaining({ status: "resolved" }),
    }));
  });
});
