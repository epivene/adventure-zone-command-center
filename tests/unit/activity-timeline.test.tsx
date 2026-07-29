// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ActivityTimeline } from "@/components/activities/activity-timeline";
import type { ActivityRevision, ActivityTimelineItem } from "@/features/activities/activity-types";

afterEach(cleanup);

const activity: ActivityTimelineItem = {
  id: "activity-1",
  organizationId: "11111111-1111-4111-8111-111111111111",
  contactId: "22222222-2222-4222-8222-222222222222",
  bookingId: null,
  kind: "call",
  body: "Updated call note.",
  occurredAt: new Date("2026-07-28T15:00:00Z"),
  createdAt: new Date("2026-07-28T15:00:00Z"),
  updatedAt: new Date("2026-07-28T15:30:00Z"),
  revisionCount: 1,
};

describe("ActivityTimeline", () => {
  it("loads revision bodies only after the owner asks to view edit history", async () => {
    const user = userEvent.setup();
    const loadRevisions = vi.fn<
      (activityId: string) => Promise<{ ok: true; revisions: ActivityRevision[] } | { ok: false; error: string }>
    >().mockResolvedValue({
      ok: true,
      revisions: [{
        id: "revision-1",
        activityId: "activity-1",
        priorBody: "Original call note.",
        replacementBody: "Updated call note.",
        reason: "Added the requested date.",
        createdAt: new Date("2026-07-28T15:30:00Z"),
      }],
    });

    render(<ActivityTimeline activities={[activity]} loadRevisions={loadRevisions} />);

    expect(screen.getByText("Updated call note.")).toBeVisible();
    expect(screen.getByRole("button", { name: "View edit history (1)" })).toBeVisible();
    expect(screen.queryByText("Original call note.")).not.toBeInTheDocument();
    expect(loadRevisions).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "View edit history (1)" }));

    expect(loadRevisions).toHaveBeenCalledWith("activity-1");
    expect(await screen.findByText("Original call note.")).toBeVisible();
    expect(screen.getByText(/Added the requested date/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Hide edit history" })).toBeVisible();
  });

  it("creates and edits activities with labeled compact forms while retaining failed values", async () => {
    const user = userEvent.setup();
    const createActivity = vi.fn().mockResolvedValue({
      ok: false,
      error: "The activity could not be saved.",
    });
    const editActivity = vi.fn().mockResolvedValue({
      ok: true,
      activity: {
        ...activity,
        body: "Corrected call summary.",
        revisionCount: 2,
      },
    });

    render(
      <ActivityTimeline
        activities={[activity]}
        createActivity={createActivity}
        editActivity={editActivity}
        loadRevisions={vi.fn()}
        parent={{ organizationId: activity.organizationId! }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Add activity" }));
    await user.type(screen.getByLabelText("Activity text"), "New account note.");
    await user.click(screen.getByRole("button", { name: "Save activity" }));
    expect(createActivity).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: activity.organizationId,
      kind: "note",
      body: "New account note.",
      occurredAt: expect.any(Date),
    }));
    expect(screen.getByText("The activity could not be saved.")).toHaveAttribute(
      "role",
      "alert",
    );
    expect(screen.getByLabelText("Activity text")).toHaveValue(
      "New account note.",
    );

    await user.click(screen.getByRole("button", { name: "Edit activity" }));
    await user.clear(screen.getByLabelText("Edited activity text"));
    await user.type(
      screen.getByLabelText("Edited activity text"),
      "Corrected call summary.",
    );
    await user.type(screen.getByLabelText("Reason for edit"), "Fixed the summary.");
    await user.click(screen.getByRole("button", { name: "Save activity edit" }));

    expect(editActivity).toHaveBeenCalledWith({
      activityId: activity.id,
      body: "Corrected call summary.",
      reason: "Fixed the summary.",
    });
    expect(screen.getByText("Corrected call summary.")).toBeVisible();
    expect(screen.getByRole("button", { name: "View edit history (2)" }))
      .toHaveAttribute("aria-expanded", "false");
  });
});
