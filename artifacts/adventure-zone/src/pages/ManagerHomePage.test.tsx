// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { describe, expect, it, vi } from "vitest";

const managerApi = vi.fn(async (path: string) => {
  if (path === "/manager/reviews/due") return { reviewsDue: [] };
  if (path === "/manager/map") {
    return {
      events: [{
        bookingId: "booking-1",
        bookingName: "Eastern Montana Fair",
        city: "Miles City",
        region: "MT",
        startsAt: "2026-08-18T12:00:00.000Z",
        status: "confirmed",
      }],
    };
  }
  if (path === "/manager/events/booking-1/lifecycle") return { lifecycle: null };
  if (path === "/manager/events/lifecycle/incomplete") return { lifecycles: [] };
  if (path === "/manager/money/summary") return { expenseTotalCents: 12500, cashPosition: { cashOnHandCents: 30000 } };
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
    expect(await screen.findByRole("button", { name: "Check in" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Schedule" })).toHaveAttribute("href", "/manager/route");
    expect(screen.getByRole("link", { name: /Receipts/i })).toHaveAttribute("href", "/manager/receipts");
    expect(screen.getByRole("link", { name: /Crew/i })).toHaveAttribute("href", "/manager/crew");
    expect(screen.getByRole("link", { name: /Mileage/i })).toHaveAttribute("href", "/manager/operations");
    expect(screen.getByText("$300.00")).toBeInTheDocument();
    expect(screen.getByText("$125.00")).toBeInTheDocument();
  });
});
