import { describe, expect, it, vi } from "vitest";

import { OperationalCalendarSyncService } from "./operational-calendar-sync-service";

describe("OperationalCalendarSyncService app authority", () => {
  it("persists the app operational window even when David calendar is disconnected", async () => {
    const reservedStart = new Date("2026-09-03T00:00:00.000Z");
    const reservedEnd = new Date("2026-09-09T00:00:00.000Z");
    const saveOperationalWindow = vi.fn().mockResolvedValue(undefined);

    const service = new OperationalCalendarSyncService(
      {
        createOperationalCalendarClient: vi.fn().mockResolvedValue(null),
      },
      {
        loadConfirmedBooking: vi.fn().mockResolvedValue({
          bookingId: "meeteetse",
          managerName: "Kristy",
          eventName: "Meeteetse Annual Labor Day Celebration 2026",
          city: "Meeteetse",
          region: "WY",
          actualEventDateText: "September 5, 2026 – September 7, 2026",
          reservedStart,
          reservedEnd,
          packages: ["zone"],
        }),
        saveOperationalWindow,
      },
      {} as any,
    );

    await expect(service.syncConfirmedBooking("meeteetse")).resolves.toEqual({ state: "not_connected" });
    expect(saveOperationalWindow).toHaveBeenCalledWith({
      bookingId: "meeteetse",
      startsAt: reservedStart,
      endsAt: reservedEnd,
      source: "app",
    });
  });
});
