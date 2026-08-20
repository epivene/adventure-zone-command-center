import { describe, expect, it } from "vitest";

import { decoratePaperNoteTimeline } from "./paper-note-activity-provenance";
import type { ActivityTimelineItem } from "@/features/activities/activity-types";

function item(id: string): ActivityTimelineItem {
  return {
    id,
    organizationId: null,
    contactId: null,
    bookingId: null,
    kind: "note",
    body: "Imported from paper notes",
    occurredAt: new Date("2026-08-20T20:00:00Z"),
    createdAt: new Date("2026-08-20T20:00:00Z"),
    updatedAt: new Date("2026-08-20T20:00:00Z"),
    revisionCount: 0,
    callOutcome: null,
    hasLinkedCallSession: false,
  };
}

describe("decoratePaperNoteTimeline", () => {
  it("marks paper-note activity and preserves unknown historical date semantics", () => {
    const paperId = "40000000-0000-4000-8000-000000000041";
    const localId = "40000000-0000-4000-8000-000000000042";
    const result = decoratePaperNoteTimeline(
      [item(paperId), item(localId)],
      [{ id: paperId, dateIsImportFallback: true, occurredAt: null }],
    );

    expect(result[0]).toMatchObject({
      historicalDateUnknown: true,
      paperNoteSource: { activityId: paperId },
    });
    expect(result[1]?.paperNoteSource ?? null).toBeNull();
  });
});
