// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { describe, expect, it, vi } from "vitest";

const managerApi = vi.fn(async (path: string) => {
  if (path === "/manager/dashboard") {
    return {
      events: [{
        bookingId: "booking-1",
        bookingName: "Eastern Montana Fair",
        city: "Miles City",
        region: "MT",
        startsAt: "2026-08-18T12:00:00.000Z",
        endsAt: "2026-08-20T12:00:00.000Z",
        operationalStartsAt: "2026-08-14T00:00:00.000Z",
        operationalEndsAt: "2026-08-23T23:59:00.000Z",
        status: "confirmed",
      }],
      currentLifecycle: null,
      incompleteWrapUps: [],
      reviewsDue: [],
      money: { expenseTotalCents: 12500, cashPosition: { cashOnHandCents: 30000 } },
      summary: { reviewsDueCount: 0 },
    };
  }
  return {};
});

vi.mock("@/lib/manager-auth-context", () => ({
  useManagerAuth: () => ({
    manager: { legId: "leg-kristy", legName: "Kristy", managerName: "Kristy" },
    managerApi,
  }),
}));
vi.mock("@/features/manager-assistant/manager-assistant-context", () => ({
  useManagerAssistant: () => ({
    activeContext: null,
    setActiveContext: vi.fn(),
    open: false,
    openAssistant: vi.fn(),
    closeAssistant: vi.fn(),
    prefill: "",
  }),
}));

import ManagerHomePage from "./ManagerHomePage";

describe("ManagerHomePage", () => {
  it("shows the next confirmed event with check in and quick destinations", async () => {
    const { hook } = memoryLocation({ path: "/manager", static: true });
    render(
      <Router hook={hook}>
        <ManagerHomePage />
      </Router>,
    );

    expect(await screen.findByText("Eastern Montana Fair")).toBeInTheDocument();
    expect(screen.getByText(/Miles City, MT/)).toBeInTheDocument();
    expect(screen.getByText(/Event dates:/)).toHaveTextContent(/Aug 18.*Aug 20/);
    expect(screen.getByText(/Buffer before:/)).toHaveTextContent(/Aug 14.*Aug 17/);
    expect(screen.getByText(/Buffer after:/)).toHaveTextContent(/Aug 21.*Aug 23/);
    expect(await screen.findByRole("button", { name: "Check in" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Schedule" })).toHaveAttribute("href", "/manager/route");
    expect(screen.getByRole("link", { name: /Receipts/i })).toHaveAttribute("href", "/manager/receipts");
    expect(screen.getByRole("link", { name: /Crew/i })).toHaveAttribute("href", "/manager/crew");
    expect(screen.getByRole("link", { name: /Mileage/i })).toHaveAttribute("href", "/manager/operations");
    expect(screen.getByText("$300.00")).toBeInTheDocument();
    expect(screen.getByText("$125.00")).toBeInTheDocument();
    expect(managerApi).toHaveBeenCalledWith("/manager/dashboard");
  });
});
