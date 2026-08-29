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
