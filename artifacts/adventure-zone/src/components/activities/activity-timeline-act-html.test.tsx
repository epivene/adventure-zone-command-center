import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ActivityTimeline } from "./activity-timeline";
import type { ActivityTimelineItem } from "@/features/activities/activity-types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function importedHistory(body: string): ActivityTimelineItem {
  return {
    id: "40000000-0000-4000-8000-000000000099",
    organizationId: "10000000-0000-4000-8000-000000000001",
    contactId: null,
    bookingId: null,
    kind: "act_history",
    body,
    occurredAt: new Date("2025-07-14T15:58:00.000Z"),
    createdAt: new Date("2026-08-16T18:00:00.000Z"),
    updatedAt: new Date("2026-08-16T18:00:00.000Z"),
    revisionCount: 0,
    callOutcome: null,
    hasLinkedCallSession: false,
    importedFromAct: true,
    actSourceType: "history",
  };
}

describe("ActivityTimeline imported ACT HTML", () => {
  it("shows existing Gmail-style ACT history as readable text instead of markup", () => {
    render(
      <ActivityTimeline
        activities={[
          importedHistory(
            `<div dir="ltr"><p><span style="font-family:Arial">Hi,</span></p><p>My name is Amy &amp; I work with Dave.</p><ul><li>Option one</li><li>Option two</li></ul></div>`,
          ),
        ]}
        loadRevisions={vi.fn().mockResolvedValue({ ok: true, revisions: [], nextPage: null })}
      />,
    );

    const card = screen.getByText("Imported from ACT · History").closest("li");
    expect(card).not.toBeNull();
    expect(card).toHaveTextContent("Hi,");
    expect(card).toHaveTextContent("My name is Amy & I work with Dave.");
    expect(card).toHaveTextContent("Option one");
    expect(card).toHaveTextContent("Option two");
    expect(card).not.toHaveTextContent("font-family");
    expect(card).not.toHaveTextContent("<div");
    expect(card).not.toHaveTextContent("&amp;");
  });
});
