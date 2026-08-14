import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ActivityTimeline } from "./activity-timeline";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ActivityTimeline deletion", () => {
  it("asks for confirmation and removes a deleted item from view", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const deleteActivity = vi.fn().mockResolvedValue({ ok: true });

    render(
      <ActivityTimeline
        activities={[{
          id: "40000000-0000-4000-8000-000000000001",
          organizationId: "10000000-0000-4000-8000-000000000001",
          contactId: null,
          bookingId: null,
          kind: "note",
          body: "Old history item",
          occurredAt: new Date("2026-08-14T12:00:00.000Z"),
          createdAt: new Date("2026-08-14T12:00:00.000Z"),
          updatedAt: new Date("2026-08-14T12:00:00.000Z"),
          revisionCount: 0,
        }]}
        deleteActivity={deleteActivity}
        loadRevisions={vi.fn().mockResolvedValue({ ok: true, revisions: [], nextPage: null })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete activity" }));

    await waitFor(() => expect(screen.queryByText("Old history item")).not.toBeInTheDocument());
    expect(deleteActivity).toHaveBeenCalledWith("40000000-0000-4000-8000-000000000001");
  });

  it("keeps the item when deletion is cancelled", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const deleteActivity = vi.fn();

    render(
      <ActivityTimeline
        activities={[{
          id: "40000000-0000-4000-8000-000000000001",
          organizationId: null,
          contactId: "20000000-0000-4000-8000-000000000001",
          bookingId: null,
          kind: "note",
          body: "Keep this history item",
          occurredAt: new Date("2026-08-14T12:00:00.000Z"),
          createdAt: new Date("2026-08-14T12:00:00.000Z"),
          updatedAt: new Date("2026-08-14T12:00:00.000Z"),
          revisionCount: 0,
        }]}
        deleteActivity={deleteActivity}
        loadRevisions={vi.fn().mockResolvedValue({ ok: true, revisions: [], nextPage: null })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete activity" }));

    expect(screen.getByText("Keep this history item")).toBeInTheDocument();
    expect(deleteActivity).not.toHaveBeenCalled();
  });
});
