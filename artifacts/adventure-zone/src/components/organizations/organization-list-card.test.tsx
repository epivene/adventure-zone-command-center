import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Router } from "wouter";

import { OrganizationList } from "./organization-list";

const query = {
  search: "",
  lastResort: "all" as const,
  travelLegId: null,
  placeType: null,
  region: null,
  hasPhone: false,
  hasEmail: false,
  hasFollowUp: false,
  hasBooking: false,
  hasLocations: false,
  showMembers: false,
  page: 1,
  pageSize: 50,
};

afterEach(cleanup);

describe("OrganizationList profile summary cards", () => {
  it("shows the profile identity, contact details, website, and rating summary without a generic type pill", () => {
    render(
      <Router>
        <OrganizationList
          organizations={{
            records: [{
              id: "10000000-0000-4000-8000-000000000001",
              name: "10 Mile Pride (Breckenridge) CO",
              city: "Breckenridge",
              region: "CO",
              lastResort: false,
              lastResortReason: null,
              lastResortChangedAt: null,
              contactCount: 1,
              bookingCount: 2,
              primaryContactName: null,
              locationCount: 0,
              matchedLocation: null,
              parentContext: null,
              phone: "(970) 547-3100",
              email: "info@breckcreate.org",
              website: "https://gobreck.com/event/breck-pride/",
              placeType: "other",
              profileImageDataUrl: "data:image/png;base64,aA==",
              ratingAverage: 4.5,
              ratingCount: 2,
            }],
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

    expect(screen.getByRole("link", { name: "10 Mile Pride (Breckenridge) CO" })).toBeVisible();
    expect(screen.getByText("Breckenridge, CO")).toBeVisible();
    expect(screen.queryByText("other")).not.toBeInTheDocument();
    expect(screen.getByText("(970) 547-3100")).toBeVisible();
    expect(screen.getByText("info@breckcreate.org")).toBeVisible();
    expect(screen.getByRole("link", { name: "https://gobreck.com/event/breck-pride/" })).toHaveAttribute("href", "https://gobreck.com/event/breck-pride/");
    expect(screen.getByText("4.5 / 5")).toBeVisible();
    expect(screen.getByText("2 rated occurrences")).toBeVisible();
    expect(screen.getByRole("img", { name: "10 Mile Pride (Breckenridge) CO profile" })).toHaveAttribute("src", "data:image/png;base64,aA==");
  });

  it("uses the compact card density for long profile lists", () => {
    render(
      <Router>
        <OrganizationList
          organizations={{
            records: [{
              id: "10000000-0000-4000-8000-000000000001",
              name: "10 Mile Pride (Breckenridge) CO",
              city: "Breckenridge",
              region: "CO",
              lastResort: false,
              lastResortReason: null,
              lastResortChangedAt: null,
              contactCount: 3,
              bookingCount: 1,
              primaryContactName: null,
              locationCount: 0,
              matchedLocation: null,
              parentContext: null,
              phone: null,
              email: null,
              website: null,
              placeType: "other",
              profileImageDataUrl: null,
              ratingAverage: null,
              ratingCount: 0,
            }],
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

    expect(screen.getByTestId("profile-summary-card")).toHaveClass("p-3");
    expect(screen.getByTestId("profile-avatar-link")).toHaveClass("size-20");
    expect(screen.getByTestId("profile-rating-summary")).toHaveClass("min-w-[7rem]");
  });

  it("makes the profile summary box keyboard and pointer addressable", () => {
    render(
      <Router>
        <OrganizationList
          organizations={{
            records: [{
              id: "10000000-0000-4000-8000-000000000001",
              name: "10 Mile Pride (Breckenridge) CO",
              city: "Breckenridge",
              region: "CO",
              lastResort: false,
              lastResortReason: null,
              lastResortChangedAt: null,
              contactCount: 0,
              bookingCount: 0,
              primaryContactName: null,
              locationCount: 0,
              matchedLocation: null,
              parentContext: null,
              phone: null,
              email: null,
              website: null,
              placeType: "other",
              profileImageDataUrl: null,
              ratingAverage: null,
              ratingCount: 0,
            }],
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

    const card = screen.getByTestId("profile-summary-card");
    expect(card).toHaveAttribute("aria-label", "Open 10 Mile Pride (Breckenridge) CO profile");
    expect(card).toHaveAttribute("tabindex", "0");

    fireEvent.click(screen.getByText("Breckenridge, CO"));
    expect(window.location.pathname).toBe("/profiles/10000000-0000-4000-8000-000000000001");
  });
});
