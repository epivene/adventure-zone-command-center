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
});
