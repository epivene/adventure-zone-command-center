import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type {
  OrganizationListPage,
  OrganizationListQuery,
} from "@/features/organizations/organization-repository";
import { OrganizationList } from "./organization-list";

const query: OrganizationListQuery = {
  search: "Austin",
  lastResort: "all",
  travelLegId: null,
  page: 1,
  pageSize: 50,
};

function listPage(
  records: Array<Record<string, unknown>>,
): OrganizationListPage {
  return {
    records,
    total: records.length,
    page: 1,
    pageSize: 50,
    pageCount: 1,
  } as OrganizationListPage;
}

function record(overrides: Record<string, unknown>) {
  return {
    id: "organization-id",
    name: "Adventure Zone",
    city: null,
    region: null,
    lastResort: false,
    lastResortReason: null,
    lastResortChangedAt: null,
    contactCount: 0,
    bookingCount: 0,
    primaryContactName: null,
    parent: null,
    locationCount: 0,
    ...overrides,
  };
}

describe("OrganizationList hierarchy rendering", () => {
  afterEach(cleanup);

  it("shows the location count for a family parent", () => {
    render(
      <OrganizationList
        organizations={listPage([
          record({
            id: "parent-id",
            name: "Adventure Zone",
            locationCount: 2,
          }),
        ])}
        query={query}
        travelLegs={[]}
      />,
    );

    expect(screen.getByText("2 locations")).toBeInTheDocument();
  });

  it("shows the parent while retaining the child profile link", () => {
    render(
      <OrganizationList
        organizations={listPage([
          record({
            id: "child-id",
            name: "Adventure Zone Austin",
            city: "Austin",
            region: "TX",
            parent: {
              id: "parent-id",
              name: "Adventure Zone",
              website: "https://example.com",
            },
          }),
        ])}
        query={query}
        travelLegs={[]}
      />,
    );

    expect(screen.getByText("Part of Adventure Zone")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Adventure Zone Austin" }),
    ).toHaveAttribute(
      "href",
      "/profiles/child-id?returnTo=%2Fprofiles%3Fq%3DAustin",
    );
  });
});
