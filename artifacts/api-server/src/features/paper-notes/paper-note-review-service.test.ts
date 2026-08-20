import { describe, expect, it, vi } from "vitest";

import { PaperNoteReviewService } from "./paper-note-review-service";
import type { PaperNoteReviewDraft } from "./paper-note-review-initializer";

function draft(): PaperNoteReviewDraft {
  return {
    event: {
      name: "Emmett Cherry Festival",
      city: "Emmett",
      region: "ID",
      venue: "",
      eventDateText: "",
      startsOn: null,
      endsOn: null,
      pageYearConfirmed: false,
    },
    activity: {
      occurredOn: "2026-04-21",
      method: "call",
      outcome: "No room this year",
      summary: "Spoke with Tina.",
    },
    contacts: [],
    organizationPhones: [],
    oldReminder: "Call Monday",
    starredOnPaper: true,
    generalNotes: [],
    destination: null,
    conflicts: {},
    currentFollowUp: { enabled: false, kind: "call", dueOn: null, contactKey: null },
  };
}

describe("PaperNoteReviewService", () => {
  it("keeps an unresolved destination in needs_review", async () => {
    const saveReview = vi.fn(async (input: any) => ({
      ...input,
      id: "entry-1",
      reviewVersion: input.expectedVersion + 1,
    }));
    const service = new PaperNoteReviewService({
      saveReview,
      approve: vi.fn(),
      unapprove: vi.fn(),
      skip: vi.fn(),
    } as any);

    const result = await service.updateEntry({
      actorId: "owner",
      entryId: "entry-1",
      expectedVersion: 2,
      review: draft(),
      now: new Date("2026-08-20T18:00:00Z"),
    });

    expect(saveReview).toHaveBeenCalledWith(expect.objectContaining({
      state: "needs_review",
      expectedVersion: 2,
      approvedAt: null,
    }));
    expect(result.reviewVersion).toBe(3);
  });

  it("marks a fully decided valid entry ready but does not auto-approve it", async () => {
    const ready = {
      ...draft(),
      destination: { mode: "new_profile", eventFamilyId: null } as const,
    };
    const saveReview = vi.fn(async (input: any) => ({ ...input, id: "entry-1", reviewVersion: 4 }));
    const service = new PaperNoteReviewService({ saveReview, approve: vi.fn(), unapprove: vi.fn(), skip: vi.fn() } as any);

    await service.updateEntry({
      actorId: "owner",
      entryId: "entry-1",
      expectedVersion: 3,
      review: ready,
      now: new Date(),
    });

    expect(saveReview).toHaveBeenCalledWith(expect.objectContaining({ state: "ready", approvedAt: null }));
  });

  it("refuses approval while blocking issues remain", async () => {
    const approve = vi.fn();
    const service = new PaperNoteReviewService({
      saveReview: vi.fn(),
      approve,
      unapprove: vi.fn(),
      skip: vi.fn(),
      getForReview: vi.fn(async () => ({ review: draft(), validationIssues: [] })),
    } as any);

    await expect(service.approveEntry({
      actorId: "owner",
      entryId: "entry-1",
      expectedVersion: 1,
      now: new Date(),
    })).rejects.toMatchObject({ code: "ENTRY_NOT_READY" });
    expect(approve).not.toHaveBeenCalled();
  });
});
