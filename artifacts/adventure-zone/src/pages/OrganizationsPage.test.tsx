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
    parse: () => ({ search: "", page: 1 }),
  },
}));
vi.mock("@/components/ui/toaster", () => ({ Toaster: () => null }));
vi.mock("@/components/organizations/duplicates-view", async () => {
  const React = await import("react");
  return {
    DuplicatesView: ({
      groups,
      onRefresh,
    }: {
      groups: Array<{ normalizedName: string }>;
      onRefresh: () => void;
    }) =>
      React.createElement(
        "div",
        null,
        React.createElement("p", null, `Merge all ${groups.length} group`),
        React.createElement(
          "button",
          { onClick: onRefresh },
          "Test background refresh",
        ),
      ),
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
    apiGet.mockImplementation((url: string) => {
      if (url.startsWith("/organizations?"))
        return Promise.resolve({ organizations: [] });
      if (
        apiGet.mock.calls.filter(
          ([calledUrl]) => calledUrl === "/organizations/duplicates",
        ).length === 1
      ) {
        return Promise.resolve({ groups });
      }
      return pendingPromise();
    });

    render(<OrganizationsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Find Duplicates" }));

    expect(await screen.findByText("Merge all 1 group")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Test background refresh" }),
    );

    expect(screen.getByText("Merge all 1 group")).toBeInTheDocument();
    expect(
      screen.queryByText("Scanning for duplicates…"),
    ).not.toBeInTheDocument();
  });

  it("keeps the loaded duplicate view mounted when background refresh fails", async () => {
    const groups = [{ normalizedName: "ten mile pride", organizations: [] }];
    let duplicateCalls = 0;
    apiGet.mockImplementation((url: string) => {
      if (url.startsWith("/organizations?"))
        return Promise.resolve({ organizations: [] });
      duplicateCalls += 1;
      return duplicateCalls === 1
        ? Promise.resolve({ groups })
        : Promise.reject(new Error("offline"));
    });

    render(<OrganizationsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Find Duplicates" }));
    expect(await screen.findByText("Merge all 1 group")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Test background refresh" }),
    );

    expect(
      await screen.findByText("Could not refresh duplicate status: offline"),
    ).toBeInTheDocument();
    expect(screen.getByText("Merge all 1 group")).toBeInTheDocument();
  });
});
