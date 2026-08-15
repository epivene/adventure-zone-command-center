import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OrganizationsPage from "./OrganizationsPage";

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));

vi.mock("wouter", () => ({ useSearch: () => "" }));
vi.mock("@/lib/auth-token", () => ({ apiGet }));
vi.mock("@/components/organizations/organization-list", () => ({
  OrganizationList: () => null,
}));
vi.mock("@/features/organizations/last-resort-input", () => ({
  organizationListQuerySchema: {
    parse: () => ({
      search: "",
      lastResort: "all",
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
    }),
  },
}));
vi.mock("@/components/ui/toaster", () => ({ Toaster: () => null }));
vi.mock("@/components/event-families/event-family-suggestions", () => ({
  EventFamilySuggestions: () => null,
}));
vi.mock("@/components/event-families/event-family-card", () => ({
  EventFamilyCard: () => null,
}));
vi.mock("@/components/organizations/duplicates-view", async () => {
  const React = await import("react");
  return {
    DuplicatesView: ({
      groups,
      onRefresh,
    }: {
      groups: Array<{ normalizedName: string }>;
      onRefresh: () => Promise<Array<{ normalizedName: string }> | null>;
    }) => {
      const [refreshResult, setRefreshResult] = React.useState<string>("not requested");
      return React.createElement(
        "div",
        null,
        React.createElement("p", null, `Merge all ${groups.length} group`),
        React.createElement(
          "button",
          {
            onClick: async () => {
              const refreshed = await onRefresh();
              setRefreshResult(refreshed?.[0]?.normalizedName ?? "unavailable");
            },
          },
          "Test background refresh",
        ),
        React.createElement("output", null, refreshResult),
      );
    },
  };
});

function pendingPromise() {
  return new Promise<never>(() => {});
}

describe("OrganizationsPage duplicate refresh", () => {
  afterEach(cleanup);

  beforeEach(() => {
    apiGet.mockReset();
  });

  it("keeps loaded duplicate controls visible during a background refresh", async () => {
    const groups = [{ normalizedName: "ten mile pride", organizations: [] }];
    let duplicateCalls = 0;
    apiGet.mockImplementation((url: string) => {
      if (url.startsWith("/organizations?")) return Promise.resolve({ organizations: [] });
      if (url !== "/organizations/duplicates") return Promise.resolve({});
      duplicateCalls += 1;
      return duplicateCalls === 1 ? Promise.resolve({ groups }) : pendingPromise();
    });

    render(<OrganizationsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Find Duplicates" }));

    expect(await screen.findByText("Merge all 1 group")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Test background refresh" }));

    expect(screen.getByText("Merge all 1 group")).toBeInTheDocument();
    expect(screen.queryByText("Scanning for duplicates…")).not.toBeInTheDocument();
  });

  it("keeps the loaded duplicate view mounted when background refresh fails", async () => {
    const groups = [{ normalizedName: "ten mile pride", organizations: [] }];
    let duplicateCalls = 0;
    apiGet.mockImplementation((url: string) => {
      if (url.startsWith("/organizations?")) return Promise.resolve({ organizations: [] });
      if (url !== "/organizations/duplicates") return Promise.resolve({});
      duplicateCalls += 1;
      return duplicateCalls === 1
        ? Promise.resolve({ groups })
        : Promise.reject(new Error("offline"));
    });

    render(<OrganizationsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Find Duplicates" }));
    expect(await screen.findByText("Merge all 1 group")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Test background refresh" }));

    expect(await screen.findByText("Could not refresh duplicate status: offline")).toBeInTheDocument();
    expect(screen.getByText("Merge all 1 group")).toBeInTheDocument();
  });

  it("returns fresh duplicate groups to the reconciliation callback", async () => {
    const initial = [{ normalizedName: "ten mile pride", organizations: [] }];
    const refreshed = [{ normalizedName: "county fair", organizations: [] }];
    let duplicateCalls = 0;
    apiGet.mockImplementation((url: string) => {
      if (url.startsWith("/organizations?")) return Promise.resolve({ organizations: [] });
      if (url !== "/organizations/duplicates") return Promise.resolve({});
      duplicateCalls += 1;
      return Promise.resolve({ groups: duplicateCalls === 1 ? initial : refreshed });
    });

    render(<OrganizationsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Find Duplicates" }));
    expect(await screen.findByText("Merge all 1 group")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Test background refresh" }));

    expect(await screen.findByText("county fair")).toBeInTheDocument();
  });
});
