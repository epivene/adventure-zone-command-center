// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EventCalendar, type CalendarEvent } from "./event-calendar";

const linkedEvent = {
  id: "booking-1",
  organizationId: "profile-1",
  name: "County Fair",
  city: "Elko",
  region: "NV",
  latitude: 40.8324,
  longitude: -115.7631,
  status: "confirmed",
  probability: "definite",
  travelLegId: "leg-1",
  travelLegName: "Dave",
  travelLegColor: "#f97316",
  startsAt: new Date("2026-09-10T12:00:00Z"),
  endsAt: new Date("2026-09-12T12:00:00Z"),
} as CalendarEvent & { organizationId: string };

afterEach(cleanup);

describe("EventCalendar profile navigation", () => {
  it("opens the event profile from an admin calendar event", () => {
    const { container } = render(<EventCalendar events={[linkedEvent]} initialMonth="2026-09" />);

    expect(container.querySelector('a[href="/profiles/profile-1"]')).not.toBeNull();
  });

  it("opens the Boss profile from a read-only Boss calendar event", () => {
    const props = {
      events: [linkedEvent],
      initialMonth: "2026-09",
      readOnly: true,
      profileBasePath: "/boss/profiles",
    } as Parameters<typeof EventCalendar>[0];

    const { container } = render(<EventCalendar {...props} />);

    expect(container.querySelector('a[href="/boss/profiles/profile-1"]')).not.toBeNull();
  });

  it("falls back to booking details for an unlinked Admin event", () => {
    const legacyEvent = { ...linkedEvent, organizationId: null } as CalendarEvent;
    const { container } = render(<EventCalendar events={[legacyEvent]} initialMonth="2026-09" />);

    expect(container.querySelector('a[href="/bookings/booking-1"]')).not.toBeNull();
  });

  it("does not create a broken Boss link for an unlinked legacy event", () => {
    const legacyEvent = { ...linkedEvent, organizationId: null } as CalendarEvent;
    const props = {
      events: [legacyEvent],
      initialMonth: "2026-09",
      readOnly: true,
      profileBasePath: "/boss/profiles",
    } as Parameters<typeof EventCalendar>[0];

    const { container } = render(<EventCalendar {...props} />);

    expect(container.querySelector('a[href^="/boss/"]')).toBeNull();
    expect(container.querySelector('a[href="/bookings/booking-1"]')).toBeNull();
  });

  it("does not stretch an open-ended potential show across every week", () => {
    const openEndedPotential = {
      ...linkedEvent,
      id: "potential-open-ended",
      status: "possible",
      probability: "possible",
      endsAt: new Date("9999-12-30T00:00:00.000Z"),
    } as CalendarEvent;

    const { container } = render(<EventCalendar events={[openEndedPotential]} initialMonth="2026-09" />);

    const spans = container.querySelectorAll('[data-testid^="booking-span-potential-open-ended-"]');
    expect(spans).toHaveLength(1);
    expect(spans[0]?.getAttribute("data-start-column")).toBe("2");
    expect(spans[0]?.getAttribute("data-end-column")).toBe("5");
  });

  it("renders potential shows dimmer than booked shows", () => {
    const potential = {
      ...linkedEvent,
      id: "potential-dimmed",
      status: "possible",
      probability: "possible",
    } as CalendarEvent;

    const { container } = render(<EventCalendar events={[linkedEvent, potential]} initialMonth="2026-09" />);

    const bookedSpan = container.querySelector('[data-testid^="booking-span-booking-1-"]') as HTMLElement;
    const potentialSpan = container.querySelector('[data-testid^="booking-span-potential-dimmed-"]') as HTMLElement;
    expect(bookedSpan.style.opacity).toBe("1");
    expect(potentialSpan.style.opacity).toBe("0.55");
  });

});
