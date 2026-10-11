import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

import { apiFetch } from "@/lib/auth-token";
import { OrganizationList } from "./organization-list";

vi.mock("@/lib/auth-token", () => ({ apiFetch: vi.fn() }));
vi.mock("@/components/profiles/profile-detail-sheet", () => ({
  ProfileDetailSheet: () => null,
}));

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
  quickFilter: null,
  filler: "all" as const,
  sort: "recently_updated" as const,
  includeRetired: false,
  page: 1,
  pageSize: 50,
};

const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(
  URL,
  "createObjectURL",
);
const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(
  URL,
  "revokeObjectURL",
);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalCreateObjectUrl) {
    Object.defineProperty(URL, "createObjectURL", originalCreateObjectUrl);
  } else {
    Reflect.deleteProperty(URL, "createObjectURL");
  }
  if (originalRevokeObjectUrl) {
    Object.defineProperty(URL, "revokeObjectURL", originalRevokeObjectUrl);
  } else {
    Reflect.deleteProperty(URL, "revokeObjectURL");
  }
});

describe("OrganizationList profile summary cards", () => {
  it("shows booking decision data with the review rating as secondary context", () => {
    render(
      <Router>
        <OrganizationList
          organizations={{
            records: [
              {
                id: "10000000-0000-4000-8000-000000000001",
                name: "10 Mile Pride (Breckenridge) CO",
                city: "Breckenridge",
                region: "CO",
                lastResort: false,
                lastResortReason: null,
                lastResortChangedAt: null,
                filler: false,
                fillerReason: null,
                fillerChangedAt: null,
                contactCount: 1,
                bookingCount: 2,
                primaryContactName: "Jamie Rivers",
                primaryContactEmail: "info@breckcreate.org",
                primaryContactPhone: "(970) 547-3100",
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
                latestRecordedEventDate: { startsOn: "2025-07-16", endsOn: null, source: "festival_edition" },
                applicationDeadline: "2026-10-01",
                pipelineStatus: "contacted",
                decisionStatus: "contacted",
                recommendedDealModel: "flat_fee",
                nextActionKind: "email",
                nextActionDueAt: "2026-09-18T15:00:00.000Z",
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

    expect(
      screen.getByRole("link", {
        name: "Open 10 Mile Pride (Breckenridge) CO profile",
      }),
    ).toBeVisible();
    expect(screen.getByText("Breckenridge, CO")).toBeVisible();
    expect(screen.queryByText("other")).not.toBeInTheDocument();
    expect(screen.getByText("Latest event Jul 16, 2025")).toBeVisible();
    expect(screen.getByText("Contacted")).toBeVisible();
    expect(screen.getByText("Flat fee")).toBeVisible();
    expect(screen.getByText(/Email.*Due Sep 18/)).toBeVisible();
    expect(screen.getByTestId("profile-rating-summary")).toHaveTextContent(
      "4.5 (2)",
    );
    expect(screen.getByTestId("profile-money-line")).toHaveTextContent(
      "Flat fee",
    );
  });

  it("uses the compact card density for long profile lists", () => {
    render(
      <Router>
        <OrganizationList
          organizations={{
            records: [
              {
                id: "10000000-0000-4000-8000-000000000001",
                name: "10 Mile Pride (Breckenridge) CO",
                city: "Breckenridge",
                region: "CO",
                lastResort: false,
                lastResortReason: null,
                lastResortChangedAt: null,
                filler: false,
                fillerReason: null,
                fillerChangedAt: null,
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

    expect(screen.getByTestId(/^profile-card-/)).toHaveClass(
      "rounded-md",
    );
    expect(screen.getByTestId("profile-list-workspace")).not.toHaveClass(
      "lg:grid-cols-[minmax(19rem,0.72fr)_minmax(0,1.28fr)]",
    );
    expect(screen.queryByTestId("profile-avatar-link")).not.toBeInTheDocument();
    expect(screen.getByTestId("profile-decision-summary")).toBeVisible();
    expect(screen.getByTestId("profile-rating-summary")).toHaveTextContent(
      "No reviews",
    );
  });

  it("writes quick filters into the same profile list query and exposes filtered CSV export", () => {
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
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Export Follow-ups" }),
    ).toBeVisible();
  });

  it("requests every filtered follow-up instead of only the visible page", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        followUps: [{
          id: "1",
          kind: "Email",
          dueAt: "2026-09-28T17:00:00Z",
          organizationName: "Killdeer Days",
          city: "Killdeer",
          region: "ND",
        }],
      }),
    } as Response);
    const createObjectUrl = vi.fn((_blob: Blob) => "blob:follow-ups");
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectUrl,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    render(
      <Router>
        <OrganizationList
          organizations={{
            records: [],
            total: 0,
            page: 4,
            pageSize: 50,
            pageCount: 6,
          }}
          query={{ ...query, region: "ND", quickFilter: "booked", page: 4 }}
          travelLegs={[]}
        />
      </Router>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Export Follow-ups" }),
    );

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    const exportUrl = vi.mocked(apiFetch).mock.calls[0]?.[0];
    expect(exportUrl).toContain("/follow-ups/export?");
    expect(exportUrl).toContain("region=ND");
    expect(exportUrl).toContain("quick=needs_follow_up");
    expect(exportUrl).not.toContain("page=4");
    await waitFor(() => expect(createObjectUrl).toHaveBeenCalledTimes(1));
    expect(createObjectUrl.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
    const clickedAnchor = anchorClick.mock.contexts[0] as
      | HTMLAnchorElement
      | undefined;
    expect(clickedAnchor?.download).toMatch(
      /^adventure-zone-follow-ups-\d{4}-\d{2}-\d{2}\.xlsx$/,
    );
  });

  it("makes the profile summary box keyboard and pointer addressable", () => {
    render(
      <Router>
        <OrganizationList
          organizations={{
            records: [
              {
                id: "10000000-0000-4000-8000-000000000001",
                name: "10 Mile Pride (Breckenridge) CO",
                city: "Breckenridge",
                region: "CO",
                lastResort: false,
                lastResortReason: null,
                lastResortChangedAt: null,
                filler: false,
                fillerReason: null,
                fillerChangedAt: null,
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

    const card = screen.getByRole("link", {
      name: "Open 10 Mile Pride (Breckenridge) CO profile",
    });
    expect(card).toHaveAttribute(
      "href",
      expect.stringContaining("/profiles/10000000-0000-4000-8000-000000000001"),
    );

    fireEvent.click(card);
    expect(window.location.pathname).toContain("/profiles/");
  });
});
