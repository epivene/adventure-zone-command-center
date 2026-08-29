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
    render(<NextEventPlanCard event={event} onSelect={onSelect} />);

    expect(screen.getByText("Miles City, MT")).toBeInTheDocument();
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
});
