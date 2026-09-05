import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

vi.mock("@/lib/boss-auth-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/boss-auth-context")>();
  return { ...actual, bossGet: vi.fn() };
});

import { bossGet } from "@/lib/boss-auth-context";
import BossBookingsPage from "./BossBookingsPage";

const mockGet = vi.mocked(bossGet);

describe("BossBookingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("displays canonical booking name, start date, location, and amount fields", async () => {
    mockGet.mockResolvedValueOnce({
      bookings: [{
        id: "booking-1",
        name: "Adventure Zone Fall Tour",
        organizationName: "Legacy organization field",
        startsAt: "2026-09-19T18:00:00.000Z",
        eventDate: "2026-09-20",
        city: "Salt Lake City",
        region: "UT",
        totalAmount: 2500,
        status: "confirmed",
      }],
    });

    const { hook } = memoryLocation({ path: "/boss/bookings", static: true });
    render(
      <Router hook={hook}>
        <BossBookingsPage />
      </Router>,
    );

    const row = await waitFor(() => screen.getByTestId("booking-row-booking-1"));
    expect(row).toHaveTextContent("Adventure Zone Fall Tour");
    expect(row).not.toHaveTextContent("Legacy organization field");
    expect(row).toHaveTextContent(/Sep 19, 2026/);
    expect(row).toHaveTextContent("Salt Lake City, UT");
    expect(row).toHaveTextContent("$2,500");
  });
});