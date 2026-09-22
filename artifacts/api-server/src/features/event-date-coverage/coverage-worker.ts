import { auditInternalEventDateEvidence, type InternalEventDateEvidence, type InternalEvidenceAudit } from "./internal-event-date-evidence";
import { extractProfileHistoryEventDateEvidence } from "@/features/profile-research/profile-research-history-clues";
import { EventDateRepository, type CoverageDatabase } from "./event-date-repository";

type JobStore = {
  claimNext(input: { workerId: string; now: Date; leaseMs: number; maxAttempts: number }): Promise<{ id: string; organizationId: string; attempts: number } | null>;
  renewLease(itemId: string, workerId: string, now: Date, leaseMs: number): Promise<unknown | null>;
  completeWithLease(
    itemId: string,
    status: "complete" | "needs_review" | "skipped",
    now: Date,
    workerId: string,
    leaseMs: number,
    work: (transaction: CoverageDatabase) => Promise<void>,
  ): Promise<unknown | null>;
  completeItem(itemId: string, status: "complete" | "needs_review" | "skipped", now: Date, workerId: string): Promise<unknown | null>;
  failItem(itemId: string, errorDetail: string, now: Date, maxAttempts: number, workerId: string): Promise<unknown | null>;
};

export type InternalEvidenceService = {
  load(organizationId: string): Promise<InternalEventDateEvidence[]>;
  apply(organizationId: string, audit: InternalEvidenceAudit, database?: CoverageDatabase): Promise<void>;
};

export type CoveragePublicResearch = {
  research(organizationId: string, lease: { itemId: string; workerId: string }): Promise<"complete" | "needs_review" | "skipped">;
};

export class CoverageWorker {
  constructor(
    private readonly jobs: JobStore,
    private readonly internal: InternalEvidenceService,
    private readonly publicResearch: CoveragePublicResearch,
    private readonly options = { leaseMs: 5 * 60_000, maxAttempts: 3 },
  ) {}

  async runOne(input: { workerId: string; now: Date }) {
    const item = await this.jobs.claimNext({ ...input, ...this.options });
    if (!item) return { kind: "idle" as const };
    try {
      const leaseNow = () => new Date(Math.max(input.now.getTime(), Date.now()));
      const audit = auditInternalEventDateEvidence({
        today: input.now.toISOString().slice(0, 10),
        evidence: await this.internal.load(item.organizationId),
      });
      if (audit.resolution !== "missing") {
        const status = audit.resolution === "needs_review" ? "needs_review" : "complete";
        const completed = await this.jobs.completeWithLease(
          item.id,
          status,
          leaseNow(),
          input.workerId,
          this.options.leaseMs,
          (transaction) => this.internal.apply(item.organizationId, audit, transaction),
        );
        if (!completed) return { kind: "lost_lease" as const };
        return { kind: "progress" as const };
      }
      const lease = await this.jobs.renewLease(item.id, input.workerId, leaseNow(), this.options.leaseMs);
      if (!lease) return { kind: "lost_lease" as const };
      const status = await this.publicResearch.research(item.organizationId, {
        itemId: item.id,
        workerId: input.workerId,
      });
      const completed = await this.jobs.completeItem(item.id, status, leaseNow(), input.workerId);
      if (!completed) return { kind: "lost_lease" as const };
      return { kind: "progress" as const };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Event date research failed";
      const failed = await this.jobs.failItem(
        item.id,
        message,
        new Date(Math.max(input.now.getTime(), Date.now())),
        this.options.maxAttempts,
        input.workerId,
      );
      if (!failed) return { kind: "lost_lease" as const };
      return {
        kind: "failed" as const,
        retryAfterMs: Math.min(60_000, 1_000 * 2 ** item.attempts),
      };
    }
  }
}

type ProfileLoader = { getEventProfile(organizationId: string): Promise<any> };

export class ProfileInternalEvidenceService implements InternalEvidenceService {
  constructor(
    private readonly profiles: ProfileLoader,
    private readonly dates: EventDateRepository,
    private readonly actorId = "event-date-coverage-worker",
  ) {}

  async load(organizationId: string): Promise<InternalEventDateEvidence[]> {
    const profile = await this.profiles.getEventProfile(organizationId);
    if (!profile) throw new Error("PROFILE_NOT_FOUND");
    const bookingEvidence: InternalEventDateEvidence[] = profile.bookings.flatMap((booking: any) => {
      if (!booking.startsAt || ["cancelled", "declined"].includes(booking.status)) return [];
      return [{
        startsOn: booking.startsAt.toISOString().slice(0, 10),
        endsOn: booking.endsAt?.toISOString().slice(0, 10) ?? null,
        evidenceKind: "booking" as const,
        sourceKind: "internal" as const,
        sourceType: "booking",
        sourceId: booking.id,
        sourceLabel: booking.name,
        excerpt: booking.notes?.slice(0, 160) ?? null,
      }];
    });
    return [...bookingEvidence, ...extractProfileHistoryEventDateEvidence(profile)];
  }

  async apply(organizationId: string, audit: InternalEvidenceAudit, database?: CoverageDatabase): Promise<void> {
    if (audit.resolution === "booked" || audit.resolution === "missing") return;
    const primary = audit.evidence[0];
    const startsOn = audit.startsOn ?? primary?.startsOn;
    if (!primary || !startsOn) return;
    const input = {
      organizationId,
      startsOn,
      endsOn: audit.endsOn ?? primary.endsOn,
      recurrenceRule: primary.recurrenceRule && primary.recurrenceRule.kind !== "unrecognized"
        ? { ...primary.recurrenceRule, calculationYear: Number(startsOn.slice(0, 4)) }
        : null,
      rationale: audit.evidence.map((item) => item.excerpt ?? item.sourceLabel).join("; "),
      sourceKind: "internal" as const,
      sourceTitle: primary.sourceLabel,
      sourceUrl: null,
      sourceRecordType: primary.sourceType,
      sourceRecordId: primary.sourceId,
      sourcePointers: audit.evidence.map((item) => ({ sourceType: item.sourceType, sourceId: item.sourceId, label: item.sourceLabel })),
      researchedAt: new Date(),
      verifiedAt: audit.resolution === "confirmed" ? new Date() : null,
      createdBy: this.actorId,
    };
    const dates = database ? new EventDateRepository(database) : this.dates;
    if (audit.resolution === "needs_review") await dates.markNeedsReview(input, database);
    else await dates.applyWithoutSupersedingConflict({ ...input, status: audit.resolution }, database);
  }
}

export class ProfileResearchCoverageProvider implements CoveragePublicResearch {
  constructor(
    private readonly service: { start(input: { profileId: string; mode: "deep"; requestedBy: string; coverageLease: { itemId: string; workerId: string } }): Promise<any> },
    private readonly applyService: {
      apply(input: { profileId: string; runId: string; suggestionIds: string[] }): Promise<{ applied: string[] }>;
    },
  ) {}
  async research(organizationId: string, lease: { itemId: string; workerId: string }): Promise<"complete" | "needs_review" | "skipped"> {
    const run = await this.service.start({
      profileId: organizationId,
      mode: "deep",
      requestedBy: "event-date-coverage-worker",
      coverageLease: lease,
    });
    const suggestions = run?.suggestions ?? [];
    const eventDateSuggestions = suggestions.filter((item: any) => item.targetKind === "event_date_fact");
    const trustworthyIds = eventDateSuggestions
      .filter((item: any) => item.confidence === "high" && !item.conflict)
      .map((item: any) => item.id);
    if (run?.id && trustworthyIds.length) {
      const applied = await this.applyService.apply({
        profileId: organizationId,
        runId: run.id,
        suggestionIds: trustworthyIds,
      });
      if (applied.applied.length) return "complete";
    }
    return eventDateSuggestions.length ? "needs_review" : "skipped";
  }
}
