import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({ archiveProfile: vi.fn() }));
vi.mock("@/actions/profile-lifecycle", () => actions);

import { ArchiveProfileButton } from "./archive-profile-button";

const PROFILE_ID = "10000000-0000-4000-8000-000000000001";
const warning = "Archive this profile? It will disappear from Profiles, search, caller matching, Today, and normal event selection. Its contacts, bookings, notes, history, and relationships will stay intact.";

beforeEach(() => {
  actions.archiveProfile.mockResolvedValue({ id: PROFILE_ID, archivedAt: "2026-08-16T22:00:00.000Z" });
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("ArchiveProfileButton", () => {
  it("confirms, archives, and redirects to archived records", async () => {
    const onArchived = vi.fn();
    render(<ArchiveProfileButton profileId={PROFILE_ID} onArchived={onArchived} />);

    fireEvent.click(screen.getByRole("button", { name: "Archive profile" }));

    expect(window.confirm).toHaveBeenCalledWith(warning);
    await waitFor(() => expect(actions.archiveProfile).toHaveBeenCalledWith(PROFILE_ID));
    expect(onArchived).toHaveBeenCalledTimes(1);
  });

  it("does nothing when confirmation is cancelled", () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    render(<ArchiveProfileButton profileId={PROFILE_ID} onArchived={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Archive profile" }));

    expect(actions.archiveProfile).not.toHaveBeenCalled();
  });

  it("stays put and shows an inline error when archive fails", async () => {
    actions.archiveProfile.mockRejectedValue(new Error("Archive failed"));
    const onArchived = vi.fn();
    render(<ArchiveProfileButton profileId={PROFILE_ID} onArchived={onArchived} />);

    fireEvent.click(screen.getByRole("button", { name: "Archive profile" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Archive failed");
    expect(onArchived).not.toHaveBeenCalled();
  });
});
