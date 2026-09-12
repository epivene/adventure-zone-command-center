import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

import { OrganizationList } from "./organization-list";

vi.mock("@/components/profiles/profile-detail-sheet", () => ({
  ProfileDetailSheet: () => null,
}));

const query = {
  search: "",
  lastResort: "all" as const,
  filler: "all" as const,
  travelLegId: null,
  placeType: null,
  region: null,
  hasPhone: false,
  hasEmail: false,
  hasFollowUp: false,
  hasBooking: false,
  hasLocations: false,
  showMembers: false,
  quickFilter: null,
  sort: "recently_updated" as const,
  page: 1,
  pageSize: 50,
};

describe("OrganizationList booking decisions", () => {
  it("puts all quick filters into the existing profile query", () => {
    render(
      <Router>
        <OrganizationList
          organizations={{
            records: [],
            total: 0,
            page: 1,
            pageSize: 50,
            pageCount: 1,
          }}
          query={query}
          travelLegs={[]}
        />
      </Router>,
    );
    expect(
      screen.getByRole("link", { name: "Deadlines soon" }),
    ).toHaveAttribute("href", expect.stringContaining("quick=deadline_soon"));
    expect(
      screen.getByRole("link", { name: "Pay-per-play candidates" }),
    ).toHaveAttribute("href", expect.stringContaining("quick=pay_per_play"));
    expect(
      screen.getByRole("link", { name: "Needs follow-up" }),
    ).toHaveAttribute("href", expect.stringContaining("quick=needs_follow_up"));
    expect(screen.getByRole("link", { name: "Booked" })).toHaveAttribute(
      "href",
      expect.stringContaining("quick=booked"),
    );
  });

  it("shows the requested card hierarchy without a primary rating block", () => {
    render(
      <Router>
        <OrganizationList
          organizations={{
            records: [
              {
                id: "10000000-0000-4000-8000-000000000001",
                name: "Prairie Days",
                city: "Denver",
                region: "CO",
                lastResort: false,
                lastResortReason: null,
                lastResortChangedAt: null,
                filler: false,
                fillerReason: null,
                fillerChangedAt: null,
                contactCount: 1,
                bookingCount: 1,
                primaryContactName: "Jamie Rivers",
                locationCount: 0,
                matchedLocation: null,
                nextEventDate: null,
                applicationDeadline: "2026-09-30",
                decisionStatus: "deadline_soon",
                recommendedDealModel: "flat_fee",
                nextActionKind: "Send pitch",
                nextActionDueAt: "2026-09-18T00:00:00Z",
                ratingAverage: 4.8,
                ratingCount: 4,
              },
            ],
            total: 1,
            page: 1,
            pageSize: 50,
            pageCount: 1,
          }}
          query={query}
          travelLegs={[]}
        />
      </Router>,
    );
    expect(screen.getByText("Prairie Days")).toBeVisible();
    expect(screen.getByText("Denver, CO")).toBeVisible();
    expect(screen.getByText("Date not published")).toBeVisible();
    expect(screen.getByText("Deadline soon")).toBeVisible();
    expect(screen.getByText("Flat fee")).toBeVisible();
    expect(screen.getByText(/Send pitch/)).toBeVisible();
    expect(
      screen.queryByTestId("profile-rating-summary"),
    ).not.toBeInTheDocument();
  });
});
