// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getOrganizationSummary, listTimeline } = vi.hoisted(() => ({
  getOrganizationSummary: vi.fn(),
  listTimeline: vi.fn(),
}));

vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/lib/auth/require-owner", () => ({
  requireOwner: vi.fn(async () => ({ userId: "owner-1" })),
}));
vi.mock("@/features/organizations/organization-repository", () => ({
  DrizzleOrganizationRepository: class {
    getOrganizationSummary = getOrganizationSummary;
  },
}));
vi.mock("@/features/activities/activity-repository", () => ({
  DrizzleActivityRepository: class {},
}));
vi.mock("@/features/activities/activity-service", () => ({
  ActivityService: class {
    listTimeline = listTimeline;
  },
}));
vi.mock("@/components/activities/activity-timeline", () => ({
  ActivityTimeline: () => <div />,
}));
vi.mock("@/components/organizations/last-resort-control", () => ({
  LastResortControl: () => <div />,
}));
vi.mock("@/components/organizations/last-resort-warning", () => ({
  LastResortWarning: () => <div />,
}));

import OrganizationDetailPage from "@/app/(private)/organizations/[organizationId]/page";
import { OrganizationList } from "@/components/organizations/organization-list";
import { AppShell } from "@/components/navigation/app-shell";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  getOrganizationSummary.mockResolvedValue({
    id: "place-1",
    name: "Marias Fair",
    lastResort: false,
    lastResortReason: null,
    lastResortChangedAt: null,
    contacts: [],
    contactTotal: 0,
    contactPage: 1,
    contactPageCount: 1,
    bookings: [],
    bookingTotal: 0,
    bookingPage: 1,
    bookingPageCount: 1,
  });
  listTimeline.mockResolvedValue([]);
});

describe("Places and Contacts navigation", () => {
  it("renders Places and Contacts as separate primary navigation destinations", () => {
    render(<AppShell><p>Page content</p></AppShell>);

    for (const label of ["Places", "Contacts"]) {
      const links = screen.getAllByRole("link", { name: label });
      expect(links).toHaveLength(2);
      for (const link of links) {
        expect(link).toHaveAttribute("href", label === "Places" ? "/organizations" : "/contacts");
      }
    }
  });

  it("carries the current Places filters into a place detail link", () => {
    render(
      <OrganizationList
        organizations={{
          records: [{
            id: "place-1",
            name: "Marias Fair",
            lastResort: false,
            lastResortReason: null,
            lastResortChangedAt: null,
            contactCount: 2,
            bookingCount: 1,
          }],
          total: 1,
          page: 2,
          pageSize: 25,
          pageCount: 2,
        }}
        query={{ search: "Marias", lastResort: "only", travelLegId: "leg-1", page: 2, pageSize: 25 }}
        travelLegs={[]}
      />,
    );

    expect(screen.getByRole("link", { name: "Marias Fair" })).toHaveAttribute(
      "href",
      "/organizations/place-1?returnTo=%2Forganizations%3Fq%3DMarias%26lastResort%3Donly%26leg%3Dleg-1%26page%3D2%26pageSize%3D25",
    );
  });

  it("returns from a place detail to its safe Places list context", async () => {
    render(await OrganizationDetailPage({
      params: Promise.resolve({ organizationId: "11111111-1111-4111-8111-111111111111" }),
      searchParams: Promise.resolve({ returnTo: "/organizations?q=Marias&page=2" }),
    }));

    expect(screen.getByRole("link", { name: "← Back to Places" })).toHaveAttribute(
      "href",
      "/organizations?q=Marias&page=2",
    );
  });

  it("falls back to Places instead of accepting a Contacts return path", async () => {
    render(await OrganizationDetailPage({
      params: Promise.resolve({ organizationId: "11111111-1111-4111-8111-111111111111" }),
      searchParams: Promise.resolve({ returnTo: "/contacts?q=Avery" }),
    }));

    expect(screen.getByRole("link", { name: "← Back to Places" })).toHaveAttribute(
      "href",
      "/organizations",
    );
  });
});
