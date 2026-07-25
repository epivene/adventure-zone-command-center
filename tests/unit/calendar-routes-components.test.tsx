// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { EventCalendar } from "@/components/calendar/event-calendar";
import { EventMap } from "@/components/routes/event-map";
import type { MapEvent } from "@/features/routes/map-data";
import type { TravelLeg } from "@/features/routes/travel-leg-repository";

afterEach(cleanup);

const events: MapEvent[] = [
  {
    id: "confirmed",
    name: "Confirmed County Fair",
    city: "Fargo",
    region: "ND",
    latitude: 46.8772,
    longitude: -96.7898,
    status: "confirmed",
    probability: "likely",
    travelLegId: "leg-1",
    travelLegName: "Leg 1",
    travelLegColor: "#DC3B3B",
    startsAt: new Date("2026-08-10T15:00:00.000Z"),
    endsAt: new Date("2026-08-12T22:00:00.000Z"),
  },
  {
    id: "pending",
    name: "Pending Contract",
    city: "Bismarck",
    region: "ND",
    latitude: null,
    longitude: null,
    status: "pending_contract",
    probability: "possible",
    travelLegId: "leg-2",
    travelLegName: "Leg 2",
    travelLegColor: "#2F73D9",
    startsAt: new Date("2026-08-20T15:00:00.000Z"),
    endsAt: null,
  },
  {
    id: "declined",
    name: "Declined",
    city: "Austin",
    region: "TX",
    latitude: 30.2672,
    longitude: -97.7431,
    status: "declined",
    probability: "unlikely",
    travelLegId: "leg-2",
    travelLegName: "Leg 2",
    travelLegColor: "#2F73D9",
    startsAt: new Date("2026-09-05T15:00:00.000Z"),
    endsAt: null,
  },
];

const travelLegs: TravelLeg[] = [
  { id: "leg-1", name: "Leg 1", color: "#DC3B3B", sortOrder: 1 },
  { id: "leg-2", name: "Leg 2", color: "#2F73D9", sortOrder: 2 },
];

describe("EventCalendar", () => {
  it("opens booking details and distinguishes confirmed from tentative events", () => {
    render(<EventCalendar events={events} initialMonth="2026-08" />);

    expect(
      screen.getByRole("link", { name: /Confirmed County Fair/ }),
    ).toHaveAttribute("href", "/bookings/confirmed");
    expect(screen.getByText("Confirmed", { selector: "span" })).toBeVisible();
    expect(screen.getAllByText("Tentative", { selector: "span" })).toHaveLength(2);
  });

  it("switches from month to agenda view without losing dated events", async () => {
    const user = userEvent.setup();
    render(<EventCalendar events={events} initialMonth="2026-08" />);

    await user.click(screen.getByRole("button", { name: "Agenda view" }));

    expect(screen.getByRole("heading", { name: "August 2026" })).toBeVisible();
    expect(screen.getByRole("link", { name: /Pending Contract/ })).toBeVisible();
  });
});

describe("EventMap", () => {
  it("filters the accessible event list and restores it with Reset filters", async () => {
    const user = userEvent.setup();
    render(<EventMap events={events} travelLegs={travelLegs} />);

    await user.selectOptions(
      screen.getByLabelText("Booking status"),
      "pending_contract",
    );

    expect(screen.getByRole("link", { name: "Pending Contract" })).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Declined" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reset filters" }));

    expect(screen.getByRole("link", { name: "Declined" })).toBeVisible();
  });

  it("reports filtered events without coordinates separately from map markers", () => {
    render(<EventMap events={events} travelLegs={travelLegs} />);

    expect(
      screen.getByRole("heading", { name: "Events without map coordinates" }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Pending Contract" }),
    ).toBeVisible();
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === "P" &&
          element.textContent?.includes("2 mapped events") === true,
      ),
    ).toBeVisible();
  });
});
