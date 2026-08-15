// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock("@/lib/auth-token", () => ({ apiGet: mocks.apiGet }));
vi.mock("./possible-locations-section", () => ({
  PossibleLocationsSection: ({ orgId }: { orgId: string }) => <div>Locations for {orgId}</div>,
}));

import { PossibleLocationsDrawer } from "./possible-locations-drawer";

afterEach(() => {
  cleanup();
  mocks.apiGet.mockReset();
});

describe("PossibleLocationsDrawer", () => {
  it("keeps the full locations list out of the profile until opened", async () => {
    mocks.apiGet.mockResolvedValue({ rollup: { locationCount: 14 } });
    render(<PossibleLocationsDrawer orgId="profile-1" />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Possible locations (14)" })).toBeInTheDocument());
    expect(screen.queryByText("Locations for profile-1")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Possible locations (14)" }));
    expect(screen.getByText("Locations for profile-1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByText("Locations for profile-1")).not.toBeInTheDocument();
  });
});
