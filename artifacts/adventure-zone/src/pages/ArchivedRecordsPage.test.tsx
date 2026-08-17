import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  getArchivedProfiles: vi.fn(),
  restoreProfile: vi.fn(),
}));

vi.mock("@/actions/profile-lifecycle", () => actions);

import ArchivedRecordsPage from "./ArchivedRecordsPage";

const PROFILE_ID = "10000000-0000-4000-8000-000000000001";

beforeEach(() => {
  actions.getArchivedProfiles.mockResolvedValue([{
    id: PROFILE_ID,
    name: "16th Street Fair",
    city: "Denver",
    region: "CO",
    archivedAt: "2026-08-16T22:00:00.000Z",
  }]);
  actions.restoreProfile.mockResolvedValue({ id: PROFILE_ID, archivedAt: null });
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("ArchivedRecordsPage", () => {
  it("lists archived profiles with location and archived date", async () => {
    render(<ArchivedRecordsPage />);
    expect(await screen.findByRole("heading", { name: "Archived records" })).toBeInTheDocument();
    expect(screen.getByText("16th Street Fair")).toBeInTheDocument();
    expect(screen.getByText("Denver, CO")).toBeInTheDocument();
    expect(screen.getByText(/Archived Aug 16, 2026/)).toBeInTheDocument();
  });

  it("restores the same profile only after confirmation and removes its card", async () => {
    render(<ArchivedRecordsPage />);
    await screen.findByText("16th Street Fair");

    fireEvent.click(screen.getByRole("button", { name: "Restore" }));

    expect(window.confirm).toHaveBeenCalledWith("Restore this profile to normal lists and searches?");
    await waitFor(() => expect(actions.restoreProfile).toHaveBeenCalledWith(PROFILE_ID));
    await waitFor(() => expect(screen.queryByText("16th Street Fair")).not.toBeInTheDocument());
  });

  it("keeps the card and shows an inline error when restore fails", async () => {
    actions.restoreProfile.mockRejectedValue(new Error("Restore failed"));
    render(<ArchivedRecordsPage />);
    await screen.findByText("16th Street Fair");

    fireEvent.click(screen.getByRole("button", { name: "Restore" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Restore failed");
    expect(screen.getByText("16th Street Fair")).toBeInTheDocument();
  });
});
