import { auditInternalEventDateEvidence, type InternalEventDateEvidence, type InternalEvidenceAudit } from "./internal-event-date-evidence";
import { extractProfileHistoryEventDateEvidence } from "@/features/profile-research/profile-research-history-clues";
import type { EventDateRepository } from "./event-date-repository";

type JobStore = {
  claimNext(input: { workerId: string; now: Date; leaseMs: number; maxAttempts: number }): Promise<{ id: string; organizationId: string; attempts: number } | null>;
  completeItem(itemId: string, status: "complete" | "needs_review" | "skipped", now: Date): Promise<unknown>;
  failItem(itemId: string, errorDetail: string, now: Date, maxAttempts: number): Promise<unknown>;
};

export type InternalEvidenceService = {
  load(organizationId: string): Promise<InternalEventDateEvidence[]>;
  apply(organizationId: string, audit: InternalEvidenceAudit): Promise<void>;
};

export type CoveragePublicResearch = {
  research(organizationId: string): Promise<"complete" | "needs_review" | "skipped">;
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
      const audit = auditInternalEventDateEvidence({
        today: input.now.toISOString().slice(0, 10),
        evidence: await this.internal.load(item.organizationId),
      });
      if (audit.resolution !== "missing") {
        await this.internal.apply(item.organizationId, audit);
        const status = audit.resolution === "needs_review" ? "needs_review" : "complete";
        await this.jobs.completeItem(item.id, status, input.now);
        return { kind: "progress" as const };
      }
      const status = await this.publicResearch.research(item.organizationId);
      await this.jobs.completeItem(item.id, status, input.now);
      return { kind: "progress" as const };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Event date research failed";
      await this.jobs.failItem(item.id, message, input.now, this.options.maxAttempts);
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

  async apply(organizationId: string, audit: InternalEvidenceAudit): Promise<void> {
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
    if (audit.resolution === "needs_review") await this.dates.markNeedsReview(input);
    else await this.dates.supersedeActiveFact({ ...input, status: audit.resolution });
  }
}

export class ProfileResearchCoverageProvider implements CoveragePublicResearch {
  constructor(private readonly service: { start(input: { profileId: string; mode: "deep"; requestedBy: string }): Promise<any> }) {}
  async research(organizationId: string): Promise<"complete" | "needs_review" | "skipped"> {
    const run = await this.service.start({
      profileId: organizationId,
      mode: "deep",
      requestedBy: "event-date-coverage-worker",
    });
    const suggestions = run?.suggestions ?? [];
    return suggestions.some((item: any) => item.targetKind === "event_date_fact")
      ? "needs_review"
      : "skipped";
  }
}
