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
});

describe("Boss schedule planning views", () => {
  it("matches the Admin schedule presentation while keeping planning view-only", async () => {
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
        bookings: [],
        trips: [],
      }],
      bookings: [{
        id: "20000000-0000-4000-8000-000000000001",
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
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    render(<BossSchedulePage />);

    expect(await screen.findByRole("heading", { name: "Schedule", level: 1 })).toBeInTheDocument();
    expect(screen.getByLabelText("Schedule view")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Calendar" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Map" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refresh" })).not.toBeInTheDocument();

    screen.getByRole("button", { name: "Show potential (1)" }).click();
    expect(await screen.findAllByText("Potential County Fair")).not.toHaveLength(0);
    expect(screen.queryByRole("link", { name: /Potential County Fair/i })).not.toBeInTheDocument();

    screen.getByRole("button", { name: "Map" }).click();
    expect(await screen.findByRole("heading", { name: "Route Map" })).toBeInTheDocument();
    expect(screen.getByText("Confirmed and potential route context across the selected season and leg.")).toBeInTheDocument();
    expect(await screen.findAllByText("Potential County Fair")).not.toHaveLength(0);
    expect(screen.queryByRole("link", { name: /Potential County Fair/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry location" })).not.toBeInTheDocument();
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
