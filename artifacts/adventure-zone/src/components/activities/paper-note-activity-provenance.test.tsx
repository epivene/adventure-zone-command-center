import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/paper-notes/paper-note-client", () => ({
  getPaperNoteActivitySource: vi.fn(async () => ({
    url: "https://signed.example/paper.jpg",
    kind: "original",
  })),
}));

import { ActivityTimeline } from "./activity-timeline";
import type { ActivityTimelineItem } from "@/features/activities/activity-types";

function item(overrides: Partial<ActivityTimelineItem> = {}): ActivityTimelineItem {
  return {
    id: "40000000-0000-4000-8000-000000000041",
    organizationId: "10000000-0000-4000-8000-000000000001",
    contactId: null,
    bookingId: null,
    kind: "note",
    body: "Imported from paper notes\nHistorical activity date: unknown\nOriginal transcription: Called office",
    occurredAt: new Date("2026-08-20T20:00:00.000Z"),
    createdAt: new Date("2026-08-20T20:00:00.000Z"),
    updatedAt: new Date("2026-08-20T20:00:00.000Z"),
    revisionCount: 0,
    callOutcome: null,
    hasLinkedCallSession: false,
    importedFromAct: false,
    actSourceType: null,
    historicalDateUnknown: true,
    paperNoteSource: { activityId: "40000000-0000-4000-8000-000000000041" },
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("paper-note activity provenance", () => {
  it("labels unknown-date paper history and keeps it immutable", () => {
    render(
      <ActivityTimeline
        activities={[item()]}
        editActivity={vi.fn()}
        deleteActivity={vi.fn()}
        loadRevisions={vi.fn().mockResolvedValue({ ok: true, revisions: [], nextPage: null })}
      />,
    );

    expect(screen.getByText("Imported from paper notes")).toBeInTheDocument();
    expect(screen.getByText(/Historical date unknown/i)).toBeInTheDocument();
    const card = screen.getByText(/Original transcription: Called office/).closest("li");
    expect(card).not.toBeNull();
    expect(card).not.toHaveTextContent("Edit activity");
    expect(card).not.toHaveTextContent("Delete activity");
    expect(screen.getByRole("button", { name: "View source paper" })).toBeInTheDocument();
  });

  it("opens the source paper lazily", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(
      <ActivityTimeline
        activities={[item({ historicalDateUnknown: false })]}
        loadRevisions={vi.fn().mockResolvedValue({ ok: true, revisions: [], nextPage: null })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "View source paper" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith(
      "https://signed.example/paper.jpg",
      "_blank",
      "noopener,noreferrer",
    ));
  });
});
