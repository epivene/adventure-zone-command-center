// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BossAuthProvider } from "@/lib/boss-auth-context";
import BossSchedulePage from "@/pages/BossSchedulePage";
import BossSignInPage from "@/pages/BossSignInPage";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Boss schedule planning views", () => {
  it("matches the Admin schedule presentation while keeping planning view-only", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-01T18:00:00Z'));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      legs: [{
        id: "10000000-0000-4000-8000-000000000001",
        name: "Leg 1",
        color: "#ea580c",
        sortOrder: 1,
        archivedAt: null,
        baseAddress: null,
        defaultVehicleName: null,
        defaultMpg: null,
        bookings: [{
          id: "20000000-0000-4000-8000-000000000002",
          organizationId: "30000000-0000-4000-8000-000000000002",
          name: "Booked Fair One",
          startsAt: "2026-09-18T12:00:00.000Z",
          status: "confirmed",
          travelLegId: "10000000-0000-4000-8000-000000000001",
        }],
        trips: [],
      }],
      bookings: [{
        id: "20000000-0000-4000-8000-000000000001",
        organizationId: "30000000-0000-4000-8000-000000000001",
        name: "Potential County Fair",
        city: "Logan",
        region: "UT",
        latitude: 41.73698,
        longitude: -111.83384,
        startsAt: "2026-09-18T12:00:00.000Z",
        endsAt: "2026-09-20T12:00:00.000Z",
        status: "possible",
        probability: "possible",
        travelLegId: null,
        travelLegName: null,
        travelLegColor: null,
      }, {
        id: "20000000-0000-4000-8000-000000000004",
        organizationId: "30000000-0000-4000-8000-000000000001",
        name: "Potential County Fair",
        city: "Logan",
        region: "UT",
        latitude: 41.73698,
        longitude: -111.83384,
        startsAt: "2026-09-18T12:00:00.000Z",
        endsAt: "2026-09-20T12:00:00.000Z",
        status: "new_lead",
        probability: "possible",
        travelLegId: null,
        travelLegName: null,
        travelLegColor: null,
      }, {
        id: "20000000-0000-4000-8000-000000000005",
        organizationId: "30000000-0000-4000-8000-000000000005",
        name: "Undated Potential",
        city: "Logan",
        region: "UT",
        latitude: 41.73698,
        longitude: -111.83384,
        startsAt: null,
        endsAt: null,
        status: "possible",
        probability: "possible",
        travelLegId: null,
        travelLegName: null,
        travelLegColor: null,
      }, {
        id: "20000000-0000-4000-8000-000000000002",
        organizationId: "30000000-0000-4000-8000-000000000002",
        name: "Booked Fair One",
        city: "Ogden",
        region: "UT",
        latitude: 41.223,
        longitude: -111.9738,
        startsAt: "2026-09-18T12:00:00.000Z",
        endsAt: "2026-09-20T12:00:00.000Z",
        status: "confirmed",
        probability: "definite",
        travelLegId: "10000000-0000-4000-8000-000000000001",
        travelLegName: "Leg 1",
        travelLegColor: "#ea580c",
      }, {
        id: "20000000-0000-4000-8000-000000000003",
        organizationId: "30000000-0000-4000-8000-000000000003",
        name: "Booked Fair Two",
        city: "Brigham City",
        region: "UT",
        latitude: 41.5102,
        longitude: -112.0155,
        startsAt: "2026-09-20T12:00:00.000Z",
        endsAt: "2026-09-22T12:00:00.000Z",
        status: "confirmed",
        probability: "definite",
        travelLegId: "10000000-0000-4000-8000-000000000001",
        travelLegName: "Leg 1",
        travelLegColor: "#ea580c",
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    render(<BossSchedulePage />);

    expect(await screen.findByRole("heading", { name: "Schedule", level: 1 })).toBeInTheDocument();
    expect(screen.getByLabelText("Schedule view")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Calendar" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Map" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refresh" })).not.toBeInTheDocument();

    screen.getByRole("button", { name: "Show potential (2)" }).click();
    screen.getByRole("button", { name: "Upcoming" }).click();
    expect(await screen.findAllByText("Potential County Fair")).not.toHaveLength(0);
    expect(screen.getAllByRole("link", { name: /Potential County Fair/i })).toEqual(
      expect.arrayContaining([expect.objectContaining({ href: expect.stringContaining("/boss/profiles/30000000-0000-4000-8000-000000000001") })]),
    );

    screen.getByRole("button", { name: "Map" }).click();
    expect(await screen.findByRole("heading", { name: "Route Map" })).toBeInTheDocument();
    expect(screen.getByText("Confirmed and potential route context across the selected season and leg.")).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "Route schedule conflicts" })).toBeInTheDocument();
    expect(screen.getAllByText("Booked Fair One").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Booked Fair Two").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Booked Fair One" }).every((link) => link.getAttribute("href")?.split("?")[0] === "/boss/profiles/30000000-0000-4000-8000-000000000002")).toBe(true);
    expect(screen.getAllByRole("link", { name: "Booked Fair Two" }).every((link) => link.getAttribute("href")?.split("?")[0] === "/boss/profiles/30000000-0000-4000-8000-000000000003")).toBe(true);
    expect(await screen.findAllByText("Potential County Fair")).not.toHaveLength(0);
    expect(screen.getAllByRole("link", { name: /Potential County Fair/i }).every((link) => link.getAttribute("href")?.split("?")[0] === "/boss/profiles/30000000-0000-4000-8000-000000000001")).toBe(true);
    expect(screen.queryByRole("button", { name: "Retry location" })).not.toBeInTheDocument();

    const overlaps = screen.getByRole("region", { name: "Route schedule conflicts" });
    expect(overlaps.tagName).toBe("DETAILS");
    expect(overlaps).not.toHaveAttribute("open");

    const routeLeg = screen.getByTestId("route-event-leg-10000000-0000-4000-8000-000000000001");
    expect(routeLeg.tagName).toBe("DETAILS");
    expect(routeLeg).not.toHaveAttribute("open");

    const bossLegs = screen.getByTestId("boss-travel-legs");
    expect(bossLegs.tagName).toBe("DETAILS");
    expect(bossLegs).not.toHaveAttribute("open");
    const bossLeg = screen.getByTestId("leg-card-10000000-0000-4000-8000-000000000001");
    expect(bossLeg.tagName).toBe("DETAILS");
    expect(bossLeg).not.toHaveAttribute("open");
    expect(screen.getAllByRole("link", { name: "Booked Fair One" }).some((link) => link.getAttribute("href")?.split("?")[0] === "/boss/profiles/30000000-0000-4000-8000-000000000002")).toBe(true);
    expect(document.querySelector('[data-testid^="button-leg-edit-"]')).toBeNull();
    expect(document.querySelector('[data-testid^="button-leg-archive-"]')).toBeNull();
  });
});

describe("Boss production sign-in", () => {
  it("does not offer demo access", async () => {
    render(<BossAuthProvider><BossSignInPage /></BossAuthProvider>);

    await waitFor(() => expect(screen.getByTestId("boss-sign-in-form")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Demo sign-in" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });
});
