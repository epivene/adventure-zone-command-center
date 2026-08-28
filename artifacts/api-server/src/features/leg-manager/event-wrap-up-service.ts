export type EventWrapUpStatus = "draft" | "submitted" | "reviewed";

export type EventWrapUp = {
  id: string;
  bookingId: string;
  legId: string;
  tripId: string | null;
  status: EventWrapUpStatus;
  ratingStars: number | null;
  ratingNotes: string | null;
  actualCashOnHandCents: number | null;
  cashDifferenceNote: string | null;
  submittedAt: Date | null;
  submittedBy: string | null;
  reviewedAt: Date | null;
  reviewedBy: string | null;
  reviewedSourceFingerprint: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type EventWrapUpDraftInput = {
  ratingStars: number | null;
  ratingNotes: string | null;
  actualCashOnHandCents: number | null;
  cashDifferenceNote: string | null;
};

export type EventTravelAllocationOverride = {
  bookingId: string;
  tripId: string;
  automaticMiles: number;
  overrideMiles: number | null;
  overrideCostCents: number | null;
  reason: string;
  updatedBy: string;
  updatedAt: Date;
};

export type EventOverheadAllocation = {
  bookingId: string;
  amountCents: number;
  label: string;
  reason: string;
  updatedBy: string;
  updatedAt: Date;
};

export type EventProfitAdjustment = {
  id: string;
  bookingId: string;
  scope: "direct" | "true_profit";
  amountCents: number;
  label: string;
  reason: string;
  createdBy: string;
  createdAt: Date;
};

export interface EventWrapUpStore {
  get(bookingId: string): Promise<EventWrapUp | null>;
  saveDraft(input: EventWrapUpDraftInput & { bookingId: string; legId: string; tripId: string | null }): Promise<EventWrapUp>;
  markSubmitted(bookingId: string, submittedBy: string | null): Promise<EventWrapUp | null>;
  markReviewed(bookingId: string, reviewedBy: string | null, sourceFingerprint: string): Promise<EventWrapUp | null>;
  reopen(bookingId: string, actor: string | null): Promise<EventWrapUp | null>;
  listSubmitted(): Promise<EventWrapUp[]>;
  averageRatingForFamily(familyId: string): Promise<{ average: number | null; count: number }>;
  getTravelOverride(bookingId: string, tripId: string): Promise<EventTravelAllocationOverride | null>;
  saveTravelOverride(input: Omit<EventTravelAllocationOverride, "updatedAt">): Promise<EventTravelAllocationOverride>;
  getOverhead(bookingId: string): Promise<EventOverheadAllocation | null>;
  saveOverhead(input: Omit<EventOverheadAllocation, "updatedAt">): Promise<EventOverheadAllocation>;
  listAdjustments(bookingId: string): Promise<EventProfitAdjustment[]>;
  addAdjustment(input: Omit<EventProfitAdjustment, "id" | "createdAt">): Promise<EventProfitAdjustment>;
  deleteAdjustment(bookingId: string, adjustmentId: string): Promise<boolean>;
}

export interface EventWrapUpSource {
  bookingContext(bookingId: string): Promise<{
    bookingId: string;
    legId: string | null;
    tripId: string | null;
    familyId: string | null;
  } | null>;
  sourceFingerprint(bookingId: string): Promise<string>;
}

function validateDraft(input: EventWrapUpDraftInput) {
  if (input.ratingStars !== null && (!Number.isInteger(input.ratingStars) || input.ratingStars < 0 || input.ratingStars > 5)) {
    throw new Error("Rating must be between 0 and 5 stars");
  }
  if (input.actualCashOnHandCents !== null && (!Number.isInteger(input.actualCashOnHandCents) || input.actualCashOnHandCents < 0)) {
    throw new Error("Actual cash must be a nonnegative amount");
  }
}

export class EventWrapUpService {
  constructor(
    private readonly store: EventWrapUpStore,
    private readonly source: EventWrapUpSource,
  ) {}

  private async ownContext(bookingId: string, managerLegId: string) {
    const context = await this.source.bookingContext(bookingId);
    if (!context) throw new Error("Event could not be found");
    if (!context.legId || context.legId !== managerLegId) throw new Error("Event is outside your leg");
    return context;
  }

  async saveManagerDraft(input: {
    bookingId: string;
    managerLegId: string;
    managerId: string | null;
    input: EventWrapUpDraftInput;
  }) {
    validateDraft(input.input);
    const context = await this.ownContext(input.bookingId, input.managerLegId);
    const existing = await this.store.get(input.bookingId);
    if (existing && existing.status !== "draft") throw new Error("Submitted wrap-ups must be reopened by admin before editing");
    return this.store.saveDraft({
      bookingId: context.bookingId,
      legId: context.legId!,
      tripId: context.tripId,
      ...input.input,
    });
  }

  async saveAdminDraft(bookingId: string, input: EventWrapUpDraftInput) {
    validateDraft(input);
    const context = await this.source.bookingContext(bookingId);
    if (!context?.legId) throw new Error("Event has no travel leg");
    const existing = await this.store.get(bookingId);
    if (existing?.status === "reviewed") throw new Error("Reopen the wrap-up before editing");
    return this.store.saveDraft({ bookingId, legId: context.legId, tripId: context.tripId, ...input });
  }

  async submitManagerWrapUp(input: {
    bookingId: string;
    managerLegId: string;
    managerId: string | null;
  }) {
    await this.ownContext(input.bookingId, input.managerLegId);
    const row = await this.store.get(input.bookingId);
    if (!row) throw new Error("Save the wrap-up draft before submitting");
    if (row.status !== "draft") throw new Error("Wrap-up is not a draft");
    const submitted = await this.store.markSubmitted(input.bookingId, input.managerId);
    if (!submitted) throw new Error("Wrap-up could not be submitted");
    return submitted;
  }

  async reviewAdminWrapUp(bookingId: string, reviewedBy: string | null) {
    const row = await this.store.get(bookingId);
    if (!row || row.status !== "submitted") throw new Error("Only submitted wrap-ups can be reviewed");
    const fingerprint = await this.source.sourceFingerprint(bookingId);
    const reviewed = await this.store.markReviewed(bookingId, reviewedBy, fingerprint);
    if (!reviewed) throw new Error("Wrap-up could not be reviewed");
    return reviewed;
  }

  async reopenAdminWrapUp(bookingId: string, actor: string | null) {
    const reopened = await this.store.reopen(bookingId, actor);
    if (!reopened) throw new Error("Only reviewed wrap-ups can be reopened");
    return reopened;
  }

  async loadAdminWrapUp(bookingId: string) {
    const wrapUp = await this.store.get(bookingId);
    if (!wrapUp) return { wrapUp: null, sourceDataChanged: false };
    const sourceDataChanged = wrapUp.status === "reviewed" && wrapUp.reviewedSourceFingerprint !== null
      ? (await this.source.sourceFingerprint(bookingId)) !== wrapUp.reviewedSourceFingerprint
      : false;
    return { wrapUp, sourceDataChanged };
  }

  async loadManagerWrapUp(bookingId: string, managerLegId: string) {
    await this.ownContext(bookingId, managerLegId);
    return this.store.get(bookingId);
  }

  listSubmittedForAdmin() {
    return this.store.listSubmitted();
  }

  averageRatingForFamily(familyId: string) {
    return this.store.averageRatingForFamily(familyId);
  }
}
