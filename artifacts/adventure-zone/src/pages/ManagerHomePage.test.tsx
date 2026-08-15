// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { describe, expect, it, vi } from "vitest";

const managerApi = vi.fn(async (path: string) => {
  if (path === "/manager/reviews/due") return { reviewsDue: [] };
  if (path === "/manager/route") {
    return {
      nextEvent: {
        bookingName: "Eastern Montana Fair",
        city: "Miles City",
        region: "MT",
        startsAt: "2026-08-18T12:00:00.000Z",
      },
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

import ManagerHomePage from "./ManagerHomePage";

describe("ManagerHomePage", () => {
  it("shows the manager's operational dashboard and quick destinations", async () => {
    const { hook } = memoryLocation({ path: "/manager", static: true });
    render(
      <Router hook={hook}>
        <ManagerHomePage />
      </Router>,
    );

    expect(await screen.findByText("Eastern Montana Fair")).toBeInTheDocument();
    expect(screen.getByText(/Miles City, MT/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Events & Route/i })).toHaveAttribute("href", "/manager/route");
    expect(screen.getByRole("link", { name: /Money/i })).toHaveAttribute("href", "/manager/money");
    expect(screen.getByRole("link", { name: /Receipts/i })).toHaveAttribute("href", "/manager/receipts");
    expect(screen.getByRole("link", { name: /Crew/i })).toHaveAttribute("href", "/manager/crew");
    expect(screen.getByRole("link", { name: /Reviews & Incidents/i })).toHaveAttribute("href", "/manager/reviews");
    expect(screen.getByRole("link", { name: /Operations/i })).toHaveAttribute("href", "/manager/operations");
  });
});
