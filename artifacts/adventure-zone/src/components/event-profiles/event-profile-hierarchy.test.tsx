import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { EventProfile } from "@/features/event-profiles/event-profile-repository";
import { EventProfileWorkspace } from "./event-profile-workspace";

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: "parent-id",
    place: {
      id: "parent-id",
      name: "Adventure Zone",
      placeType: "event",
      phone: null,
      address1: null,
      address2: null,
      city: null,
      region: null,
      postalCode: null,
      website: "adventurezone.com",
      lastResort: false,
      lastResortReason: null,
      actRecordId: null,
    },
    contacts: [],
    selectedContactId: null,
    bookings: [],
    notes: [],
    followUps: [],
    groups: [],
    sourceProvenance: [],
    parent: null,
    locations: [{
      id: "reno-id",
      name: "Adventure Zone Reno",
      address1: "100 River Road",
      address2: "Suite 4",
      city: "Reno",
      region: "NV",
      postalCode: "89501",
      website: "https://reno.adventurezone.com",
      localStatus: "confirmed",
      nextFollowUp: {
        id: "follow-up-id",
        kind: "confirm_details",
        dueAt: new Date("2027-04-14T00:00:00.000Z"),
      },
      nextBooking: {
        id: "booking-id",
        name: "Reno Summer Event",
        startsAt: new Date("2027-05-15T00:00:00.000Z"),
        status: "confirmed",
      },
      travelLeg: { id: "leg-id", name: "Northern Nevada", color: "#f97316" },
      primaryContactName: "Jordan Lee",
    }],
    rollups: {
      locationCount: 1,
      upcomingBookingCount: 1,
      overdueFollowUpCount: 0,
      travelLegs: [{ id: "leg-id", name: "Northern Nevada", color: "#f97316" }],
      mostRecentContactAt: new Date("2027-04-01T00:00:00.000Z"),
    },
    ...overrides,
  } as EventProfile;
}

describe("EventProfileWorkspace hierarchy rendering", () => {
  afterEach(cleanup);

  it("renders parent website actions and complete location cards", () => {
    render(<EventProfileWorkspace profile={profile()} />);

    expect(screen.getByRole("heading", { name: "Locations & Events" })).toBeInTheDocument();
    expect(screen.getByText("100 River Road, Suite 4, Reno, NV, 89501")).toBeInTheDocument();
    expect(screen.getByText("Status: confirmed")).toBeInTheDocument();
    expect(screen.getByText("Next booking:")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reno Summer Event" })).toHaveAttribute("href", "/bookings/booking-id");
    expect(screen.getByText("Next follow-up: confirm details")).toBeInTheDocument();
    expect(screen.getByText("Travel leg: Northern Nevada")).toBeInTheDocument();
    expect(screen.getByText("Primary contact: Jordan Lee")).toBeInTheDocument();

    const websiteLinks = screen.getAllByRole("link", { name: "Visit website" });
    expect(websiteLinks).toHaveLength(2);
    for (const link of websiteLinks) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noreferrer noopener");
    }
  });

  it("shows a child profile's parent and leaves unsafe website text unlinked", () => {
    const child = profile({
      id: "reno-id",
      place: {
        id: "reno-id",
        name: "Adventure Zone Reno",
        placeType: "event",
        phone: null,
        address1: "100 River Road",
        address2: null,
        city: "Reno",
        region: "NV",
        postalCode: "89501",
        website: "javascript:alert(1)",
        lastResort: false,
        lastResortReason: null,
        actRecordId: null,
      },
      parent: {
        id: "parent-id",
        name: "Adventure Zone",
        website: "javascript:alert(1)",
      },
      locations: [],
    });

    render(<EventProfileWorkspace profile={child} />);

    expect(screen.getByText("Part of Adventure Zone")).toBeInTheDocument();
    expect(screen.getAllByText("javascript:alert(1)")).toHaveLength(2);
    expect(screen.queryByRole("link", { name: "Visit website" })).not.toBeInTheDocument();
  });
});
