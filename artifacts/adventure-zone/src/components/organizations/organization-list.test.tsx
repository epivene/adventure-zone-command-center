import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrganizationList } from "./organization-list";

vi.mock("wouter", () => ({
  Link: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
    <a {...props}>{children}</a>
  ),
  useLocation: () => ["/profiles", () => {}],
}));

const organizations = {
  records: [],
  total: 0,
  page: 1,
  pageSize: 50,
  pageCount: 1,
};

describe("OrganizationList filters", () => {
  afterEach(cleanup);

  it("renders independent contact and activity filters so they can be combined", () => {
    render(
      <OrganizationList
        organizations={organizations}
        query={{
          search: "",
          lastResort: "all",
          travelLegId: null,
          placeType: null,
          region: null,
          hasPhone: true,
          hasEmail: true,
          hasFollowUp: true,
          hasBooking: true,
          hasLocations: false,
          showMembers: false,
          page: 1,
          pageSize: 50,
        }}
        travelLegs={[]}
      />,
    );

    expect(screen.getByRole("checkbox", { name: "Has phone" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Has email" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Has follow-up" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Has booking" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Show family/group members" })).not.toBeChecked();
  });
});


describe("OrganizationList About previews", () => {
  it("shows a two-line description preview when a profile has an About section", () => {
    render(
      <OrganizationList
        organizations={{
          records: [{
            id: "profile-1",
            name: "Prairie Days",
            city: "Denver",
            region: "CO",
            description: "A long event description that should be available as a compact preview in the directory.",
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
          }],
          total: 1,
          page: 1,
          pageSize: 50,
          pageCount: 1,
        }}
        query={{
          search: "",
          lastResort: "all",
          filler: "all",
          travelLegId: null,
          placeType: null,
          region: null,
          hasPhone: false,
          hasEmail: false,
          hasFollowUp: false,
          hasBooking: false,
          hasLocations: false,
          showMembers: false,
          sort: "recently_updated",
          page: 1,
          pageSize: 50,
        }}
        travelLegs={[]}
      />,
    );

    const preview = screen.getByText("A long event description that should be available as a compact preview in the directory.");
    expect(preview).toBeVisible();
    expect(preview).toHaveClass("line-clamp-2");
  });

  it("does not render a preview for a blank description", () => {
    render(
      <OrganizationList
        organizations={{
          records: [{
            id: "profile-2",
            name: "Blank Profile",
            city: null,
            region: null,
            description: "   ",
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
          }],
          total: 1,
          page: 1,
          pageSize: 50,
          pageCount: 1,
        }}
        query={{
          search: "",
          lastResort: "all",
          filler: "all",
          travelLegId: null,
          placeType: null,
          region: null,
          hasPhone: false,
          hasEmail: false,
          hasFollowUp: false,
          hasBooking: false,
          hasLocations: false,
          showMembers: false,
          sort: "recently_updated",
          page: 1,
          pageSize: 50,
        }}
        travelLegs={[]}
      />,
    );

    expect(screen.queryByTestId("profile-about-preview")).not.toBeInTheDocument();
  });
});
