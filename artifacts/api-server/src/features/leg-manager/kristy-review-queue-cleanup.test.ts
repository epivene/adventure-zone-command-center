import { describe, expect, it } from "vitest";

import {
  KRISTY_STALE_REVIEW_CANDIDATES,
  cleanupKristyReviewQueue,
  type KristyReviewCleanupRepository,
  type ManagerLegMatch,
  type ReviewCleanupInspection,
} from "./kristy-review-queue-cleanup";

class FakeRepository implements KristyReviewCleanupRepository {
  dismissals: Array<{ legId: string; bookingIds: string[]; reason: string }> = [];

  constructor(
    private readonly legs: ManagerLegMatch[],
    private readonly inspections: ReviewCleanupInspection[],
    private readonly dismissResult: "applied" | "already_current" | "changed" = "applied",
  ) {}

  async findKristyLegs() {
    return this.legs;
  }

  async inspectCandidates() {
    return this.inspections;
  }

  async dismissAll(legId: string, bookingIds: string[], reason: string) {
    this.dismissals.push({ legId, bookingIds, reason });
    return this.dismissResult;
  }
}

function exactInspections(overrides?: Partial<ReviewCleanupInspection>): ReviewCleanupInspection[] {
  return KRISTY_STALE_REVIEW_CANDIDATES.map((candidate) => ({
    ...candidate,
    reviewCount: 0,
    dismissedAt: null,
    ...overrides,
  }));
}

const kristyLeg: ManagerLegMatch = {
  legId: "58f246aa-6517-4bd0-a4dc-89de4f9f158d",
  managerName: "Kristy",
  legName: "Kristy",
};

describe("cleanupKristyReviewQueue", () => {
  it("dismisses only the five exact historical prompts requested by the owner", async () => {
    const repository = new FakeRepository([kristyLeg], exactInspections());

    const result = await cleanupKristyReviewQueue(repository, new Date("2026-09-01T18:00:00Z"));

    expect(result).toEqual({
      status: "applied",
      legId: kristyLeg.legId,
      bookingIds: KRISTY_STALE_REVIEW_CANDIDATES.map((candidate) => candidate.id),
    });
    expect(repository.dismissals).toHaveLength(1);
    expect(repository.dismissals[0]).toEqual({
      legId: kristyLeg.legId,
      bookingIds: KRISTY_STALE_REVIEW_CANDIDATES.map((candidate) => candidate.id),
      reason: expect.stringContaining("Miles City"),
    });
  });

  it("is repeat-safe when the five prompts are already dismissed", async () => {
    const repository = new FakeRepository(
      [kristyLeg],
      exactInspections({ dismissedAt: new Date("2026-09-01T12:00:00Z") }),
    );

    const result = await cleanupKristyReviewQueue(repository, new Date("2026-09-01T18:00:00Z"));

    expect(result.status).toBe("already_current");
    expect(repository.dismissals).toEqual([]);
  });

  it("refuses cleanup if Kristy is ambiguous, an identity changed, or a report now exists", async () => {
    const ambiguous = new FakeRepository(
      [kristyLeg, { ...kristyLeg, legId: "3c37125f-50e5-4f20-81ff-51322de836b0" }],
      exactInspections(),
    );
    await expect(
      cleanupKristyReviewQueue(ambiguous, new Date("2026-09-01T18:00:00Z")),
    ).resolves.toEqual(expect.objectContaining({ status: "skipped", reason: "manager_ambiguous" }));
    expect(ambiguous.dismissals).toEqual([]);

    const changed = exactInspections();
    changed[0] = { ...changed[0]!, name: "Different Moorcroft Event" };
    const changedRepository = new FakeRepository([kristyLeg], changed);
    await expect(
      cleanupKristyReviewQueue(changedRepository, new Date("2026-09-01T18:00:00Z")),
    ).resolves.toEqual(expect.objectContaining({ status: "skipped", reason: "candidate_changed" }));
    expect(changedRepository.dismissals).toEqual([]);

    const reviewed = exactInspections();
    reviewed[2] = { ...reviewed[2]!, reviewCount: 1 };
    const reviewedRepository = new FakeRepository([kristyLeg], reviewed);
    await expect(
      cleanupKristyReviewQueue(reviewedRepository, new Date("2026-09-01T18:00:00Z")),
    ).resolves.toEqual(expect.objectContaining({ status: "skipped", reason: "completed_report_present" }));
    expect(reviewedRepository.dismissals).toEqual([]);
  });

  it("refuses cleanup before every candidate is actually due", async () => {
    const repository = new FakeRepository([kristyLeg], exactInspections());

    const result = await cleanupKristyReviewQueue(repository, new Date("2026-07-10T18:00:00Z"));

    expect(result).toEqual(expect.objectContaining({ status: "skipped", reason: "candidate_not_due" }));
    expect(repository.dismissals).toEqual([]);
  });
});
