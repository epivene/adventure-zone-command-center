import { describe, expect, it, vi } from "vitest";

import { OpportunityEmailAvailability } from "./opportunity-email-availability";

const opportunity = {
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  eventYear: 2026,
  bookingId: "33333333-3333-4333-8333-333333333333",
  contactId: null,
  status: "ready_to_contact",
  emailAutomationProtected: false,
  territoryExceptionApproved: false,
};

function deps() {
  return {
    bookings: {
      get: vi.fn(async () => ({
        id: opportunity.bookingId!,
        startsAt: new Date("2026-09-10T15:00:00.000Z"),
        endsAt: new Date("2026-09-12T23:00:00.000Z"),
      })),
    },
    calendars: {
      selected: vi.fn(async () => [{ id: "calendar-a", summary: "Adventure Zone", primary: true }]),
    },
    packages: {
      active: vi.fn(async () => [
        { code: "adventure_zone", name: "Adventure Zone", normalCapacity: 5, temporaryUnavailableQuantity: 0 },
        { code: "pirates_rebellion", name: "Pirate's Rebellion", normalCapacity: 3, temporaryUnavailableQuantity: 0 },
        { code: "weekend_warriors", name: "Warrior's Playground", normalCapacity: 1, temporaryUnavailableQuantity: 0 },
      ]),
    },
    google: {
      readClient: vi.fn(async () => ({
        listCalendarEvents: vi.fn(async () => [{
          calendarId: "calendar-a",
          calendarTimeZone: "America/Denver",
          id: "event-1",
          iCalUid: "event-1@example.com",
          summary: "1 Adventure Zone Booking",
          description: "",
          start: { date: "2026-09-11" },
          end: { date: "2026-09-13" },
          updated: "2026-08-27T12:00:00.000Z",
          recurringEventId: null,
          originalStartTime: null,
        }]),
      })),
    },
  };
}

describe("OpportunityEmailAvailability", () => {
  it("checks selected calendars across the opportunity window and calculates package capacity", async () => {
    const dependencies = deps();
    const availability = new OpportunityEmailAvailability(dependencies);
    const result = await availability.resolve(opportunity);

    expect(result.calendarEvidence).toEqual([
      expect.objectContaining({ calendarId: "calendar-a", eventId: "event-1" }),
    ]);
    expect(result.packageAvailability).toEqual(expect.objectContaining({
      status: "resolved",
      packages: expect.arrayContaining([
        expect.objectContaining({ packageKey: "adventure_zone", bookedQuantity: 1, availableQuantity: 4 }),
        expect.objectContaining({ packageKey: "pirates_rebellion", availableQuantity: 3 }),
        expect.objectContaining({ packageKey: "weekend_warriors", availableQuantity: 1 }),
      ]),
    }));
  });

  it("returns missing evidence instead of guessing when dates, calendars, or Google access are unavailable", async () => {
    const noBooking = deps();
    noBooking.bookings.get.mockResolvedValue(null as never);
    await expect(new OpportunityEmailAvailability(noBooking).resolve(opportunity)).resolves.toEqual({
      calendarEvidence: [],
      packageAvailability: null,
    });

    const noCalendars = deps();
    noCalendars.calendars.selected.mockResolvedValue([]);
    await expect(new OpportunityEmailAvailability(noCalendars).resolve(opportunity)).resolves.toEqual({
      calendarEvidence: [],
      packageAvailability: null,
    });

    const noGoogle = deps();
    noGoogle.google.readClient.mockResolvedValue(null as never);
    await expect(new OpportunityEmailAvailability(noGoogle).resolve(opportunity)).resolves.toEqual({
      calendarEvidence: [],
      packageAvailability: null,
    });
  });

  it("keeps ambiguous Calendar package evidence unresolved so guardrails can block drafting", async () => {
    const dependencies = deps();
    const client = await dependencies.google.readClient();
    client.listCalendarEvents.mockResolvedValue([{
      calendarId: "calendar-a",
      calendarTimeZone: "America/Denver",
      id: "event-ambiguous",
      iCalUid: null,
      summary: "Adventure Zone Booking",
      description: "package TBD",
      start: { date: "2026-09-11" },
      end: { date: "2026-09-13" },
      updated: null,
      recurringEventId: null,
      originalStartTime: null,
    }]);
    dependencies.google.readClient.mockResolvedValue(client);

    const result = await new OpportunityEmailAvailability(dependencies).resolve(opportunity);
    expect(result.calendarEvidence).toHaveLength(1);
    expect(result.packageAvailability).toEqual(expect.objectContaining({ status: "unresolved" }));
  });
});
