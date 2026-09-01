import { describe, expect, it } from "vitest";

import {
  DON_KING_DAYS_BOOKING,
  KRISTY_REVIEW_PROMPT_BOOKINGS,
  correctKristyReviewState,
  type DonKingInspection,
  type KristyReviewStateCorrectionRepository,
  type ManagerLegMatch,
  type ReviewPromptInspection,
} from "./kristy-review-state-correction";

const kristyLeg: ManagerLegMatch = {
  legId: "0f495fb4-a2fe-473c-ae51-1e4a5e4d0a6d",
  managerName: "Kristy",
  legName: "Kristy",
};

class FakeRepository implements KristyReviewStateCorrectionRepository {
  applyCalls = 0;

  constructor(
    public legs: ManagerLegMatch[] = [kristyLeg],
    public reviewPrompts: ReviewPromptInspection[] = KRISTY_REVIEW_PROMPT_BOOKINGS.map(
      (booking) => ({
        ...booking,
        assignedLegId: kristyLeg.legId,
        dismissalPresent: true,
        reviewCount: 0,
      }),
    ),
    public donKing: DonKingInspection = {
      ...DON_KING_DAYS_BOOKING,
      status: "new_lead",
      assignedLegId: kristyLeg.legId,
      persistedAssignmentLegId: kristyLeg.legId,
    },
  ) {}

  async findKristyLegs() {
    return this.legs;
  }

  async inspectReviewPrompts() {
    return this.reviewPrompts;
  }

  async inspectDonKingDays() {
    return this.donKing;
  }

  async applyCorrection(input: {
    legId: string;
    restoreBookingIds: string[];
    donKingBookingId: string;
    unassignDonKing: boolean;
    clearDonKingPersistedAssignment: boolean;
    reason: string;
  }) {
    this.applyCalls += 1;
    for (const prompt of this.reviewPrompts) {
      if (input.restoreBookingIds.includes(prompt.id)) prompt.dismissalPresent = false;
    }
    if (input.unassignDonKing) this.donKing.assignedLegId = null;
    if (input.clearDonKingPersistedAssignment) {
      this.donKing.persistedAssignmentLegId = null;
    }
    return "applied" as const;
  }
}

describe("correctKristyReviewState", () => {
  it("restores the five exact prompts and removes Don King Days from Kristy's leg", async () => {
    const repository = new FakeRepository();

    const result = await correctKristyReviewState(repository);

    expect(result).toEqual({
      status: "applied",
      legId: kristyLeg.legId,
      restoredBookingIds: KRISTY_REVIEW_PROMPT_BOOKINGS.map((booking) => booking.id),
      donKingDays: "unassigned",
    });
    expect(repository.applyCalls).toBe(1);
    expect(repository.reviewPrompts.every((prompt) => !prompt.dismissalPresent)).toBe(true);
    expect(repository.donKing.assignedLegId).toBeNull();
    expect(repository.donKing.persistedAssignmentLegId).toBeNull();
  });

  it("is repeat-safe when the prompts are already visible and Don King Days is already off Kristy's leg", async () => {
    const repository = new FakeRepository();
    repository.reviewPrompts = repository.reviewPrompts.map((prompt) => ({
      ...prompt,
      dismissalPresent: false,
    }));
    repository.donKing = {
      ...repository.donKing,
      assignedLegId: null,
      persistedAssignmentLegId: null,
    };

    const result = await correctKristyReviewState(repository);

    expect(result).toEqual({
      status: "already_current",
      legId: kristyLeg.legId,
      restoredBookingIds: [],
      donKingDays: "already_unassigned",
    });
    expect(repository.applyCalls).toBe(0);
  });

  it("preserves Don King Days when it has already been moved to a different leg", async () => {
    const repository = new FakeRepository();
    repository.reviewPrompts = repository.reviewPrompts.map((prompt) => ({
      ...prompt,
      dismissalPresent: false,
    }));
    repository.donKing = {
      ...repository.donKing,
      assignedLegId: "67fd9373-8377-46f0-a74a-c46cd8ecdd4a",
      persistedAssignmentLegId: "67fd9373-8377-46f0-a74a-c46cd8ecdd4a",
    };

    const result = await correctKristyReviewState(repository);

    expect(result).toEqual({
      status: "already_current",
      legId: kristyLeg.legId,
      restoredBookingIds: [],
      donKingDays: "assigned_elsewhere",
    });
    expect(repository.applyCalls).toBe(0);
    expect(repository.donKing.assignedLegId).toBe(
      "67fd9373-8377-46f0-a74a-c46cd8ecdd4a",
    );
  });

  it("fails closed when Kristy is ambiguous or an exact booking identity changed", async () => {
    const ambiguous = new FakeRepository([
      kristyLeg,
      { ...kristyLeg, legId: "67fd9373-8377-46f0-a74a-c46cd8ecdd4a" },
    ]);
    await expect(correctKristyReviewState(ambiguous)).resolves.toEqual(
      expect.objectContaining({ status: "skipped", reason: "manager_ambiguous" }),
    );
    expect(ambiguous.applyCalls).toBe(0);

    const changedReview = new FakeRepository();
    changedReview.reviewPrompts[0] = {
      ...changedReview.reviewPrompts[0]!,
      name: "Different Moorcroft Event",
    };
    await expect(correctKristyReviewState(changedReview)).resolves.toEqual(
      expect.objectContaining({ status: "skipped", reason: "review_identity_changed" }),
    );
    expect(changedReview.applyCalls).toBe(0);

    const changedDonKing = new FakeRepository();
    changedDonKing.donKing = { ...changedDonKing.donKing, status: "confirmed" };
    await expect(correctKristyReviewState(changedDonKing)).resolves.toEqual(
      expect.objectContaining({ status: "skipped", reason: "don_king_changed" }),
    );
    expect(changedDonKing.applyCalls).toBe(0);
  });
});
