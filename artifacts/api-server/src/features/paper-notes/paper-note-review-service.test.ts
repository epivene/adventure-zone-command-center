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

function fullEntry(review: PaperNoteReviewDraft, reviewVersion = 3) {
  return {
    review,
    validationIssues: [],
    state: "ready" as const,
    reviewVersion,
    extraction: { transcription: "Original paper text" } as any,
    approvedAt: null,
  };
}

describe("PaperNoteReviewService", () => {
  it("normalizes a saved full state name when the review is opened", async () => {
    const saved = {
      ...draft(),
      event: { ...draft().event, city: "Enoch", region: "UTAH" },
    };
    const service = new PaperNoteReviewService({
      getForReview: vi.fn(async () => ({
        review: saved,
        validationIssues: [],
        state: "needs_review",
        reviewVersion: 2,
        extraction: {} as any,
        approvedAt: null,
      })),
    } as any);

    const result = await service.getEntry("owner", "entry-1");
    expect(result.review.event.region).toBe("UT");
  });

  it("removes an already-saved empty contact instead of making it mandatory", async () => {
    const saved = {
      ...draft(),
      contacts: [{
        key: "contact-0",
        mode: "new_contact" as const,
        selectedContactId: null,
        name: "",
        role: null,
        email: null,
        primary: true,
        phones: [],
      }],
    };
    const service = new PaperNoteReviewService({
      getForReview: vi.fn(async () => ({
        review: saved,
        validationIssues: [],
        state: "needs_review",
        reviewVersion: 2,
        extraction: {} as any,
        approvedAt: null,
      })),
    } as any);
    const result = await service.getEntry("owner", "entry-1");
    expect(result.review.contacts).toEqual([]);
  });

  it("keeps an unresolved destination in needs_review", async () => {
    const savedReview = draft();
    const saveReview = vi.fn(async (input: any) => ({ ...input, id: "entry-1", reviewVersion: input.expectedVersion + 1 }));
    const getForReview = vi.fn(async () => fullEntry(savedReview, 3));
    const service = new PaperNoteReviewService({ saveReview, getForReview, approve: vi.fn(), unapprove: vi.fn(), skip: vi.fn() } as any);
    const result = await service.updateEntry({ actorId: "owner", entryId: "entry-1", expectedVersion: 2, review: savedReview, now: new Date("2026-08-20T18:00:00Z") });
    expect(saveReview).toHaveBeenCalledWith(expect.objectContaining({ state: "needs_review", expectedVersion: 2, approvedAt: null }));
    expect(result.reviewVersion).toBe(3);
  });

  it("returns the full entry including extraction after saving a profile choice", async () => {
    const ready = { ...draft(), destination: { mode: "new_profile", eventFamilyId: null } as const };
    const saveReview = vi.fn(async (input: any) => ({ ...input, id: "entry-1", reviewVersion: 4 }));
    const getForReview = vi.fn(async () => fullEntry(ready, 4));
    const service = new PaperNoteReviewService({ saveReview, getForReview, approve: vi.fn(), unapprove: vi.fn(), skip: vi.fn() } as any);

    const result = await service.updateEntry({ actorId: "owner", entryId: "entry-1", expectedVersion: 3, review: ready, now: new Date() });

    expect(result.extraction.transcription).toBe("Original paper text");
    expect(result.review.destination).toEqual(ready.destination);
    expect(getForReview).toHaveBeenCalledWith("owner", "entry-1");
  });

  it("marks a fully decided valid entry ready but does not auto-approve it", async () => {
    const ready = { ...draft(), destination: { mode: "new_profile", eventFamilyId: null } as const };
    const saveReview = vi.fn(async (input: any) => ({ ...input, id: "entry-1", reviewVersion: 4 }));
    const getForReview = vi.fn(async () => fullEntry(ready, 4));
    const service = new PaperNoteReviewService({ saveReview, getForReview, approve: vi.fn(), unapprove: vi.fn(), skip: vi.fn() } as any);
    await service.updateEntry({ actorId: "owner", entryId: "entry-1", expectedVersion: 3, review: ready, now: new Date() });
    expect(saveReview).toHaveBeenCalledWith(expect.objectContaining({ state: "ready", approvedAt: null }));
  });

  it("returns the full entry including extraction after approval", async () => {
    const ready = { ...draft(), destination: { mode: "new_profile", eventFamilyId: null } as const };
    const beforeApproval = fullEntry(ready, 5);
    const afterApproval = { ...fullEntry(ready, 6), state: "approved" as const, approvedAt: "2026-08-20T18:00:00.000Z" };
    const getForReview = vi.fn()
      .mockResolvedValueOnce(beforeApproval)
      .mockResolvedValueOnce(afterApproval);
    const approve = vi.fn(async () => ({
      id: "entry-1",
      review: ready,
      validationIssues: [],
      state: "approved",
      reviewVersion: 6,
      approvedAt: "2026-08-20T18:00:00.000Z",
    }));
    const service = new PaperNoteReviewService({
      saveReview: vi.fn(),
      approve,
      unapprove: vi.fn(),
      skip: vi.fn(),
      getForReview,
    } as any);

    const result = await service.approveEntry({ actorId: "owner", entryId: "entry-1", expectedVersion: 5, now: new Date("2026-08-20T18:00:00Z") });

    expect(result.extraction.transcription).toBe("Original paper text");
    expect(result.state).toBe("approved");
  });

  it("refuses approval while blocking issues remain", async () => {
    const approve = vi.fn();
    const service = new PaperNoteReviewService({
      saveReview: vi.fn(),
      approve,
      unapprove: vi.fn(),
      skip: vi.fn(),
      getForReview: vi.fn(async () => ({ review: draft(), validationIssues: [], state: "needs_review" })),
    } as any);
    await expect(service.approveEntry({ actorId: "owner", entryId: "entry-1", expectedVersion: 1, now: new Date() })).rejects.toMatchObject({ code: "ENTRY_NOT_READY" });
    expect(approve).not.toHaveBeenCalled();
  });

  it("refuses direct approval after stale preflight returned the entry to needs_review", async () => {
    const approve = vi.fn();
    const readyReview = { ...draft(), destination: { mode: "new_profile", eventFamilyId: null } as const };
    const service = new PaperNoteReviewService({
      saveReview: vi.fn(),
      approve,
      unapprove: vi.fn(),
      skip: vi.fn(),
      getForReview: vi.fn(async () => ({ review: readyReview, validationIssues: [], state: "needs_review" })),
    } as any);
    await expect(service.approveEntry({ actorId: "owner", entryId: "entry-1", expectedVersion: 5, now: new Date() })).rejects.toMatchObject({ code: "ENTRY_NOT_READY" });
    expect(approve).not.toHaveBeenCalled();
  });
});
