import { OpenAiLeadScoutProvider } from "./openai-lead-scout-provider";
import type { LeadScoutProvider } from "./lead-scout-provider";
import type { LeadScoutCandidateView, LeadScoutSourceInput } from "./lead-scout-types";
import {
  evaluateScoutAlerts,
  monitoringProblemAlert,
} from "./scout-alert-classifier";
import {
  ScoutAlertRepository,
  type ScoutAlertWatchContext,
} from "./scout-alert-repository";
import {
  baselineScoutAlertSnapshot,
  researchedScoutAlertSnapshot,
} from "./scout-alert-snapshot";
import type { ScoutAlertSnapshot } from "./scout-alert-types";

type WorkerRepository = Pick<
  ScoutAlertRepository,
  "claimDue" | "loadContext" | "saveSuccess" | "recordFailure" | "completeWatch"
>;

const DAY_MS = 24 * 60 * 60 * 1_000;
const FINAL_BOOKING_STATUSES = new Set(["completed", "cancelled", "declined"]);

function candidateInput(candidate: LeadScoutCandidateView) {
  return {
    name: candidate.name,
    city: candidate.city,
    region: candidate.region,
    venue: candidate.venue,
    startsAt: candidate.startsAt,
    endsAt: candidate.endsAt,
    website: candidate.website,
    eventType: candidate.eventType,
    rationale: candidate.fitRationale,
  };
}

function dateDay(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function todayDay(now: Date) {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function daysUntil(value: string | null, now: Date) {
  const day = dateDay(value);
  return day === null ? null : Math.floor((day - todayDay(now)) / DAY_MS);
}

function shouldComplete(context: ScoutAlertWatchContext, now: Date) {
  if (context.bookingStatus && FINAL_BOOKING_STATUSES.has(context.bookingStatus)) return true;
  const end = context.bookingEndsAt ?? context.candidate.endsAt;
  const endDay = dateDay(end);
  return endDay !== null && Math.floor((todayDay(now) - endDay) / DAY_MS) > 14;
}

function nearTerm(snapshot: ScoutAlertSnapshot, now: Date) {
  const deadlineDays = daysUntil(snapshot.applicationDeadline, now);
  const eventDays = daysUntil(snapshot.startsAt, now);
  return Boolean(
    (deadlineDays !== null && deadlineDays >= 0 && deadlineDays <= 30)
    || (eventDays !== null && eventDays >= 0 && eventDays <= 60),
  );
}

function nextResearchAt(snapshot: ScoutAlertSnapshot, now: Date) {
  return new Date(now.getTime() + (nearTerm(snapshot, now) ? DAY_MS : 7 * DAY_MS));
}

function retryAt(now: Date, newFailureCount: number) {
  const hours = Math.min(24 * 7, 6 * (2 ** Math.max(0, newFailureCount - 1)));
  return new Date(now.getTime() + hours * 60 * 60 * 1_000);
}

function safeError(cause: unknown) {
  const value = cause instanceof Error ? cause.message : "Scout monitoring refresh failed";
  return value.replace(/\s+/g, " ").trim().slice(0, 500) || "Scout monitoring refresh failed";
}

function mergedSources(known: LeadScoutSourceInput[], refreshed: LeadScoutSourceInput[]) {
  const result: LeadScoutSourceInput[] = [];
  const seen = new Set<string>();
  for (const source of [...refreshed, ...known]) {
    if (!source.url || seen.has(source.url)) continue;
    seen.add(source.url);
    result.push(source);
    if (result.length >= 40) break;
  }
  return result;
}

export class ScoutAlertWorker {
  private readonly repository: WorkerRepository;
  private readonly provider: Pick<LeadScoutProvider, "enrichCandidate">;
  private readonly leaseMs: number;

  constructor(options: {
    repository?: WorkerRepository;
    provider?: Pick<LeadScoutProvider, "enrichCandidate">;
    leaseMs?: number;
  } = {}) {
    this.repository = options.repository ?? new ScoutAlertRepository();
    this.provider = options.provider ?? new OpenAiLeadScoutProvider();
    this.leaseMs = Math.max(10_000, options.leaseMs ?? 90_000);
  }

  async runOne(input: { workerId: string; now: Date }): Promise<{ kind: "idle" | "progress" }> {
    const claim = await this.repository.claimDue({
      workerId: input.workerId,
      now: input.now,
      leaseMs: this.leaseMs,
    });
    if (!claim) return { kind: "idle" };

    const context = await this.repository.loadContext(claim);
    if (!context || shouldComplete(context, input.now)) {
      await this.repository.completeWatch({ claim, now: input.now });
      return { kind: "progress" };
    }

    const baseline = claim.snapshot ?? baselineScoutAlertSnapshot({
      candidate: context.candidate,
      sources: context.knownSources,
      now: input.now,
    });
    let current = baseline;
    let researched = false;

    try {
      if (new Date(claim.nextResearchAt).getTime() <= input.now.getTime()) {
        const enrichment = await this.provider.enrichCandidate({
          criteria: context.criteria,
          candidate: candidateInput(context.candidate),
          knownSources: context.knownSources.slice(0, 32),
        });
        const sources = mergedSources(context.knownSources, enrichment.sources);
        current = researchedScoutAlertSnapshot({
          candidate: context.candidate,
          facts: enrichment.facts,
          sources,
          coverageGaps: enrichment.coverageGaps,
          now: input.now,
        });
        researched = true;
      }

      const alerts = evaluateScoutAlerts({
        watchId: claim.watchId,
        profileName: context.profileName,
        previous: claim.snapshot,
        current,
        now: input.now,
        baseline: claim.snapshot === null,
      });
      await this.repository.saveSuccess({
        claim,
        snapshot: current,
        alerts,
        now: input.now,
        nextEvaluationAt: new Date(input.now.getTime() + DAY_MS),
        nextResearchAt: researched
          ? nextResearchAt(current, input.now)
          : new Date(claim.nextResearchAt),
        researched,
      });
    } catch (cause) {
      const newFailureCount = claim.failureCount + 1;
      await this.repository.recordFailure({
        claim,
        profileName: context.profileName,
        now: input.now,
        safeError: safeError(cause),
        nextRetryAt: retryAt(input.now, newFailureCount),
        failureAlert: monitoringProblemAlert({
          watchId: claim.watchId,
          profileName: context.profileName,
          failureCount: newFailureCount,
        }),
      });
    }

    return { kind: "progress" };
  }
}
