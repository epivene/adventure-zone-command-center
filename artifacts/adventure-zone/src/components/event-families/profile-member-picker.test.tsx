// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const apiGet = vi.fn();
vi.mock("@/lib/auth-token", () => ({ apiGet }));

import { ProfileMemberPicker } from "./profile-member-picker";

afterEach(() => {
  cleanup();
  apiGet.mockReset();
});

describe("ProfileMemberPicker", () => {
  it("searches the full profile dataset with grouped members included", async () => {
    apiGet.mockResolvedValue({
      organizations: {
        records: [{
          id: "profile-1",
          name: "Miles City Celebration",
          city: "Miles City",
          region: "MT",
          lastResort: false,
          lastResortReason: null,
          lastResortChangedAt: null,
          contactCount: 1,
          bookingCount: 0,
          primaryContactName: null,
          locationCount: 0,
          matchedLocation: null,
          parentContext: null,
          eventFamilyId: null,
        }],
        total: 1,
        page: 1,
        pageSize: 20,
        pageCount: 1,
      },
    });
    const onSelect = vi.fn();

    render(<ProfileMemberPicker familyId="family-1" onSelect={onSelect} />);
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith(expect.stringContaining("showMembers=yes")));

    fireEvent.change(screen.getByLabelText("Search all profiles"), { target: { value: "Miles City" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => expect(apiGet).toHaveBeenLastCalledWith(expect.stringContaining("q=Miles+City")));
    fireEvent.click(await screen.findByRole("button", { name: /Miles City Celebration/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add existing profile" }));
    expect(onSelect).toHaveBeenCalledWith("profile-1");
  });

  it("blocks silent reassignment from another family", async () => {
    apiGet.mockResolvedValue({
      organizations: {
        records: [{
          id: "profile-2",
          name: "Other Festival",
          city: "Billings",
          region: "MT",
          lastResort: false,
          lastResortReason: null,
          lastResortChangedAt: null,
          contactCount: 0,
          bookingCount: 0,
          primaryContactName: null,
          locationCount: 0,
          matchedLocation: null,
          parentContext: { kind: "event_family", id: "family-2", name: "Other Family" },
          eventFamilyId: "family-2",
        }],
        total: 1,
        page: 1,
        pageSize: 20,
        pageCount: 1,
      },
    });

    render(<ProfileMemberPicker familyId="family-1" onSelect={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Other Festival/ }));

    expect(screen.getByText("Already in another event family")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add existing profile" })).toBeDisabled();
  });
});
