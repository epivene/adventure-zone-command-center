import { describe, expect, it, vi } from "vitest";

import { OperationalCalendarSyncService } from "./operational-calendar-sync-service";

describe("OperationalCalendarSyncService duplicate prevention", () => {
  it("links one exact legacy package event instead of creating another Google event", async () => {
    const existingEvent = {
      id: "existing-meeteetse-zone",
      etag: '"legacy"',
      summary: "KRISTY Meeteetse Annual Labor Day Celebration 2026 - Meeteetse WY (Zone)",
      description: "Existing calendar details",
      startDate: "2026-09-03",
      endDateExclusive: "2026-09-09",
      updated: "2026-08-31T20:00:00.000Z",
      status: "confirmed",
    };
    const createEvent = vi.fn().mockResolvedValue({ ...existingEvent, id: "new-duplicate" });
    const saved: Array<{ googleEventId: string; bookingId: string; packageKey: string }> = [];

    const service = new OperationalCalendarSyncService(
      {
        createOperationalCalendarClient: vi.fn().mockResolvedValue({
          connectionId: "connection",
          calendarId: "dave",
          client: {
            getEvent: vi.fn().mockResolvedValue(null),
            listEvents: vi.fn().mockResolvedValue({ events: [existingEvent], nextPageToken: null }),
            createEvent,
            updateEvent: vi.fn(),
          },
        }),
      },
      {
        ensureAppOperationalWindow: vi.fn().mockResolvedValue(undefined),
        loadConfirmedBooking: vi.fn().mockResolvedValue({
          bookingId: "meeteetse",
          managerName: "Kristy",
          eventName: "Meeteetse Annual Labor Day Celebration 2026",
          city: "Meeteetse",
          region: "WY",
          actualEventDateText: "September 5, 2026 - September 7, 2026",
          reservedStart: new Date("2026-09-03T00:00:00.000Z"),
          reservedEnd: new Date("2026-09-09T00:00:00.000Z"),
          packages: ["zone"],
        }),
        saveOperationalWindow: vi.fn().mockResolvedValue(undefined),
      },
      {
        findByBookingPackage: vi.fn().mockResolvedValue(null),
        saveSuccessfulSync: vi.fn(async (input) => {
          saved.push(input);
          return { id: "link", ...input, lastSyncedAt: input.syncedAt, lastErrorCode: null } as any;
        }),
        recordSyncError: vi.fn(),
        createReview: vi.fn(),
      },
    );

    await expect(service.syncConfirmedBooking("meeteetse")).resolves.toEqual({
      state: "synced",
      created: 0,
      updated: 1,
    });
    expect(saved).toMatchObject([{
      googleEventId: "existing-meeteetse-zone",
      bookingId: "meeteetse",
      packageKey: "zone",
    }]);
    expect(createEvent).not.toHaveBeenCalled();
  });
});
