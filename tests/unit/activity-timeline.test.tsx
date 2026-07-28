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
});
