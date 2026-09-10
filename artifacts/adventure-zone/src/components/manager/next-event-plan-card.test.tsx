// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextEventPlanCard } from "./next-event-plan-card";

const event = {
  bookingId: "booking-1",
  bookingName: "Eastern Montana Fair",
  city: "Miles City",
  region: "MT",
  latitude: 46.4083,
  longitude: -105.8406,
  startsAt: "2026-08-20T12:00:00.000Z",
  endsAt: "2026-08-20T16:00:00.000Z",
  operationalStartsAt: "2026-08-16T00:00:00.000Z",
  operationalEndsAt: "2026-08-23T00:00:00.000Z",
  status: "confirmed",
  probability: null,
  scheduleState: "booked",
} as const;

describe("NextEventPlanCard", () => {
  afterEach(() => {
    delete window.umami;
  });

  it("shows the destination and opens coordinate directions while selecting the event", () => {
    const onSelect = vi.fn();
    render(<NextEventPlanCard
      event={event}
      onSelect={onSelect}
      route={{
        trip: {
          id: "trip-1",
          name: "Kristy route",
          startLabel: "Prior stop",
          startLatitude: 44.5,
          startLongitude: -109.5,
          endLabel: "Home",
          endLatitude: 40.2,
          endLongitude: -111.9,
          mpg: 10,
          fuelPricePerGallon: 3.5,
        },
        stops: [{ ...event, id: "stop-1", sortOrder: 1 }],
        segments: [{
          id: "segment-1",
          fromLabel: "Prior stop",
          toLabel: "Eastern Montana Fair",
          effectiveMiles: 120,
          effectiveMinutes: 150,
        }],
      }}
    />);

    expect(screen.getByText("Miles City, MT")).toBeInTheDocument();
    expect(screen.getByText(/Event dates:/)).toHaveTextContent(/Aug 20/);
    expect(screen.getByText(/Buffer before:/)).toHaveTextContent(/Aug 16.*Aug 19/);
    expect(screen.getByText(/Buffer after:/)).toHaveTextContent(/Aug 21.*Aug 22/);
    expect(screen.getByText("120 mi")).toBeInTheDocument();
    expect(screen.getByText("2 hr 30 min")).toBeInTheDocument();
    expect(screen.getByText("$42.00 estimated gas")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Get directions" })).toHaveAttribute(
      "href",
      expect.stringContaining("destination=46.4083%2C-105.8406"),
    );
    fireEvent.click(screen.getByRole("button", { name: "View Eastern Montana Fair details" }));
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("tracks coordinate directions clicks without blocking the directions link", () => {
    const track = vi.fn();
    window.umami = { track };
    render(<NextEventPlanCard event={event} onSelect={vi.fn()} />);

    const link = screen.getByRole("link", { name: "Get directions" });
    fireEvent.click(link);

    expect(track).toHaveBeenCalledWith("next_event_directions_clicked", {
      surface: "manager_schedule",
      destination_type: "coordinates",
    });
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("uses the city and region when the event has no coordinates", () => {
    const track = vi.fn();
    window.umami = { track };
    render(
      <NextEventPlanCard
        event={{ ...event, latitude: null, longitude: null }}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByRole("link", { name: "Get directions" })).toHaveAttribute(
      "href",
      expect.stringContaining("destination=Miles+City%2C+MT"),
    );
    fireEvent.click(screen.getByRole("link", { name: "Get directions" }));
    expect(track).toHaveBeenCalledWith("next_event_directions_clicked", {
      surface: "manager_schedule",
      destination_type: "city_region",
    });
  });

  it("keeps directions usable when analytics throws", () => {
    window.umami = { track: vi.fn(() => { throw new Error("analytics unavailable"); }) };
    render(<NextEventPlanCard event={event} onSelect={vi.fn()} />);

    const link = screen.getByRole("link", { name: "Get directions" });
    expect(() => fireEvent.click(link)).not.toThrow();
    expect(link).toHaveAttribute("href", expect.stringContaining("destination=46.4083%2C-105.8406"));
  });
  it("shows estimated fuel gallons when a fuel price has not been configured", () => {
    render(<NextEventPlanCard event={event} onSelect={vi.fn()} route={{
      trip: {
        id: "manager-navigation:leg-1",
        navigationOnly: true,
        name: "Current to next",
        startLabel: "Current",
        startLatitude: 44.1,
        startLongitude: -108.8,
        endLabel: event.bookingName,
        endLatitude: null,
        endLongitude: null,
        mpg: 10,
        fuelPricePerGallon: null,
      },
      stops: [{ ...event, id: "navigation-stop", sortOrder: 1 }],
      segments: [{
        id: "navigation-segment",
        fromLabel: "Current",
        toLabel: event.bookingName,
        effectiveMiles: 525,
        effectiveMinutes: 510,
      }],
    }} />);

    expect(screen.getByText("52.5 gal estimated fuel")).toBeInTheDocument();
  });


});
