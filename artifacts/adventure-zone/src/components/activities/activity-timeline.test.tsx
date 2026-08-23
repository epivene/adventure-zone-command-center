import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ActivityTimeline } from "./activity-timeline";
import type { ActivityTimelineItem } from "@/features/activities/activity-types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function activityTimelineItem(
  overrides: Partial<ActivityTimelineItem> = {},
): ActivityTimelineItem {
  return {
    id: "40000000-0000-4000-8000-000000000001",
    organizationId: "10000000-0000-4000-8000-000000000001",
    contactId: null,
    bookingId: null,
    kind: "note",
    body: "Activity note",
    occurredAt: new Date("2026-08-14T12:00:00.000Z"),
    createdAt: new Date("2026-08-14T12:00:00.000Z"),
    updatedAt: new Date("2026-08-14T12:00:00.000Z"),
    revisionCount: 0,
    callOutcome: null,
    hasLinkedCallSession: false,
    ...overrides,
  };
}

describe("ActivityTimeline call editing", () => {
  it("shows linked call outcome and submits edited note with changed outcome", async () => {
    const linkedCall = activityTimelineItem({
      kind: "call",
      body: "Initial call note",
      callOutcome: "left_voicemail",
      hasLinkedCallSession: true,
    });
    const editedCall = {
      ...linkedCall,
      body: "Talked with Amy",
      callOutcome: "spoke_with_contact" as const,
    };
    const editActivity = vi.fn().mockResolvedValue({
      ok: true,
      activity: editedCall,
    });

    render(
      <ActivityTimeline
        activities={[linkedCall]}
        editActivity={editActivity}
        loadRevisions={vi
          .fn()
          .mockResolvedValue({ ok: true, revisions: [], nextPage: null })}
      />,
    );

    expect(screen.getByText("Left voicemail")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit call" }));
    fireEvent.change(screen.getByLabelText("Call outcome"), {
      target: { value: "spoke_with_contact" },
    });
    fireEvent.change(screen.getByLabelText("Edited call note"), {
      target: { value: "Talked with Amy" },
    });
    fireEvent.change(screen.getByLabelText("Reason for edit"), {
      target: { value: "Corrected entry" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save call edit" }));

    await waitFor(() =>
      expect(editActivity).toHaveBeenCalledWith({
        activityId: linkedCall.id,
        body: "Talked with Amy",
        callOutcome: "spoke_with_contact",
        reason: "Corrected entry",
      }),
    );
  });

  it("keeps the note-only editor for unlinked imported calls", () => {
    render(
      <ActivityTimeline
        activities={[
          activityTimelineItem({
            kind: "call",
            body: "Imported call note",
            callOutcome: "left_voicemail",
            hasLinkedCallSession: false,
          }),
        ]}
        editActivity={vi.fn()}
        loadRevisions={vi
          .fn()
          .mockResolvedValue({ ok: true, revisions: [], nextPage: null })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit activity" }));

    expect(screen.getByLabelText("Edited activity text")).toBeInTheDocument();
    expect(screen.queryByLabelText("Call outcome")).not.toBeInTheDocument();
  });
});

describe("ActivityTimeline deletion", () => {
  it("asks for confirmation and removes a deleted item from view", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const deleteActivity = vi.fn().mockResolvedValue({ ok: true });

    render(
      <ActivityTimeline
        activities={[activityTimelineItem({ body: "Old history item" })]}
        deleteActivity={deleteActivity}
        loadRevisions={vi
          .fn()
          .mockResolvedValue({ ok: true, revisions: [], nextPage: null })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete activity" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }));

    await waitFor(() =>
      expect(screen.queryByText("Old history item")).not.toBeInTheDocument(),
    );
    expect(deleteActivity).toHaveBeenCalledWith(
      "40000000-0000-4000-8000-000000000001",
    );
  });

  it("keeps the item when deletion is cancelled", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const deleteActivity = vi.fn();

    render(
      <ActivityTimeline
        activities={[
          activityTimelineItem({
            organizationId: null,
            contactId: "20000000-0000-4000-8000-000000000001",
            body: "Keep this history item",
          }),
        ]}
        deleteActivity={deleteActivity}
        loadRevisions={vi
          .fn()
          .mockResolvedValue({ ok: true, revisions: [], nextPage: null })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete activity" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByText("Keep this history item")).toBeInTheDocument();
    expect(deleteActivity).not.toHaveBeenCalled();
  });
});

describe("ActivityTimeline imported ACT provenance", () => {
  it("labels imported ACT history and hides mutation controls while local notes remain editable", () => {
    const imported = activityTimelineItem({
      id: "40000000-0000-4000-8000-000000000010",
      kind: "act_history",
      body: "Proposal package sent",
      importedFromAct: true,
      actSourceType: "history",
    } as Partial<ActivityTimelineItem> & Record<string, unknown>);
    const local = activityTimelineItem({
      id: "40000000-0000-4000-8000-000000000011",
      body: "Local correction note",
    });

    render(
      <ActivityTimeline
        activities={[imported, local]}
        editActivity={vi.fn()}
        deleteActivity={vi.fn()}
        loadRevisions={vi
          .fn()
          .mockResolvedValue({ ok: true, revisions: [], nextPage: null })}
      />,
    );

    expect(screen.getByText("Imported from ACT · History")).toBeInTheDocument();
    const importedCard = screen.getByText("Proposal package sent").closest("li");
    expect(importedCard).not.toBeNull();
    expect(importedCard).not.toHaveTextContent("Edit activity");
    expect(importedCard).not.toHaveTextContent("Delete activity");

    const localCard = screen.getByText("Local correction note").closest("li");
    expect(localCard).not.toBeNull();
    expect(localCard).toHaveTextContent("Edit activity");
    expect(localCard).toHaveTextContent("Delete activity");
  });
});

describe("ActivityTimeline paper note source", () => {
  it("shows View original note and opens the source for paper-note activities", async () => {
    const openPaperNoteSource = vi.fn().mockResolvedValue(undefined);
    const paperNote = activityTimelineItem({
      body: "Imported handwritten note",
      paperNoteSource: { activityId: "40000000-0000-4000-8000-000000000001" },
    });

    render(
      <ActivityTimeline
        activities={[paperNote]}
        loadRevisions={vi.fn().mockResolvedValue({ ok: true, revisions: [], nextPage: null })}
        openPaperNoteSource={openPaperNoteSource}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "View original note" }));

    await waitFor(() => expect(openPaperNoteSource).toHaveBeenCalledWith(paperNote.id));
  });

  it("does not show a source button on ordinary notes", () => {
    render(
      <ActivityTimeline
        activities={[activityTimelineItem()]}
        loadRevisions={vi.fn().mockResolvedValue({ ok: true, revisions: [], nextPage: null })}
        openPaperNoteSource={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "View original note" })).not.toBeInTheDocument();
  });
});
