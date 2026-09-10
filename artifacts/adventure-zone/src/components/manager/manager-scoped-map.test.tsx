// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const layerProps = vi.hoisted(() => ({ showRoute: false }));

vi.mock("@/components/routes/manager-route-map-shell", () => ({
  ManagerRouteMapShell: ({ children }: { children: React.ReactNode }) => <div data-testid="map-shell">{children}</div>,
  useManagerRouteMap: () => null,
}));

vi.mock("./manager-scoped-map-layers", () => ({
  ManagerScopedMapLayers: ({ data, showRoute }: any) => {
    layerProps.showRoute = showRoute;
    return <div>
      {data.events.map((event: any) => <span key={event.bookingId}>{event.bookingName}</span>)}
      {data.meetups.map((meetup: any) => (
        <span key={meetup.id}>
          Meet {meetup.counterpart.kind === "leg" ? meetup.counterpart.legName : meetup.counterpart.displayName} — {meetup.resourceName}
          {meetup.counterpart.kind === "external_contact" && meetup.counterpart.phone ? ` ${meetup.counterpart.phone}` : ""}
        </span>
      ))}
    </div>;
  },
}));

import { ManagerScopedMap } from "./manager-scoped-map";

const baseData = {
  leg: { id: "kristy", name: "Kristy", color: "#f97316" },
  route: {
    trip: {
      id: "trip-1",
      name: "Kristy route",
      startLabel: "Utah base",
      startLatitude: 40.2,
      startLongitude: -111.9,
      endLabel: "Utah base",
      endLatitude: 40.2,
      endLongitude: -111.9,
    },
    stops: [{ id: "stop-1", bookingId: "booking-1", bookingName: "Eastern Montana Fair", city: "Miles City", region: "MT", latitude: 46.4083, longitude: -105.8406, sortOrder: 1, startsAt: new Date("2026-08-20T12:00:00Z"), endsAt: null }],
    segments: [],
  },
  events: [{ bookingId: "booking-1", bookingName: "Eastern Montana Fair", city: "Miles City", region: "MT", latitude: 46.4083, longitude: -105.8406, startsAt: new Date("2026-08-20T12:00:00Z"), endsAt: null, status: "confirmed" }],
  meetups: [],
} as any;

describe("ManagerScopedMap", () => {
  it("renders own-leg events in the manager map", () => {
    render(<ManagerScopedMap data={baseData} variant="operations" />);
    expect(screen.getByText("Eastern Montana Fair")).toBeInTheDocument();
    expect(screen.queryByText("Hulk private stop")).not.toBeInTheDocument();
  });


  it("draws route geometry on the manager Schedule events map", () => {
    render(<ManagerScopedMap data={baseData} variant="events" />);
    expect(layerProps.showRoute).toBe(true);
  });

  it("renders a leg meetup with the counterpart name", () => {
    const data = { ...baseData, meetups: [{ id: "m1", status: "approved", resourceName: "Paintball trailer", meetupLabel: "Billings transfer", meetupLatitude: 45.78, meetupLongitude: -108.5, windowStartsAt: new Date(), windowEndsAt: new Date(), counterpart: { kind: "leg", legId: "hulk", legName: "Hulk" } }] };
    render(<ManagerScopedMap data={data as any} variant="operations" />);
    expect(screen.getByText(/Meet Hulk — Paintball trailer/)).toBeInTheDocument();
  });

  it("renders an outside runner meetup with permitted phone information", () => {
    const data = { ...baseData, meetups: [{ id: "m2", status: "approved", resourceName: "Paintball trailer", meetupLabel: "Billings transfer", meetupLatitude: 45.78, meetupLongitude: -108.5, windowStartsAt: new Date(), windowEndsAt: new Date(), counterpart: { kind: "external_contact", externalContactId: null, displayName: "Jordan Smith", phone: "555-0100", email: null } }] };
    render(<ManagerScopedMap data={data as any} variant="events" />);
    expect(screen.getByText(/Meet Jordan Smith — Paintball trailer 555-0100/)).toBeInTheDocument();
  });
});
