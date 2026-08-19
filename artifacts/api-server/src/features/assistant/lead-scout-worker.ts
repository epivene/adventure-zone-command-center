import { db } from "@workspace/db";

import {
  matchRelatedEventsAgainstCrm,
  type RelatedEventCrmMatch,
} from "@/features/profile-research/profile-research-related-event-matcher";
import type { RelatedEventOpportunity } from "@/features/profile-research/profile-research-discovery";
import { LeadScoutRepository } from "./lead-scout-repository";
import { OpenAiLeadScoutProvider } from "./openai-lead-scout-provider";
import type { LeadScoutProvider } from "./lead-scout-provider";
import type { LeadScoutCandidateView, LeadScoutSourceInput } from "./lead-scout-types";

type Matcher = (
  events: RelatedEventOpportunity[],
) => Promise<Array<RelatedEventOpportunity & { crmMatch: RelatedEventCrmMatch }>>;

type WorkerRepository = Pick<
  LeadScoutRepository,
  | "claimRunnable"
  | "renewLease"
  | "getRun"
  | "isCancellationRequested"
  | "upsertSources"
  | "upsertCandidates"
  | "updateProgress"
  | "setCandidateCrmMatch"
  | "setCandidateFit"
  | "stopRun"
  | "completeRun"
  | "failRun"
>;

function candidateEvent(candidate: LeadScoutCandidateView): RelatedEventOpportunity | null {
  if (!candidate.website) return null;
  return {
    name: candidate.name,
    city: candidate.city,
    region: candidate.region,
    startsAt: candidate.startsAt,
    endsAt: candidate.endsAt,
    venue: candidate.venue,
    url: candidate.website,
    rationale: candidate.fitRationale ?? "Found by Lead Scout.",
  };
}

function baselineFit(candidate: LeadScoutCandidateView, regions: string[]) {
  let score = 0;
  const reasons: string[] = [];
  if (candidate.startsAt) { score += 25; reasons.push("date fits the requested window"); }
  if (candidate.region && regions.includes(candidate.region)) { score += 20; reasons.push("location fits the requested area"); }
  if (candidate.website) { score += 15; reasons.push("public event source is available"); }
  if (/fair|festival|family|community|carnival|celebration/i.test(candidate.eventType ?? candidate.name)) {
    score += 25;
    reasons.push("event format is a good Adventure Zone prospect");
  }
  if (candidate.city || candidate.venue) { score += 10; reasons.push("location details are available"); }
  if (candidate.crmMatchStatus === "new_prospect") { score += 5; reasons.push("not currently matched in Command Center"); }
  return {
    score: Math.min(100, score),
    rationale: reasons.length ? reasons.join("; ") : "Needs more research before ranking.",
  };
}

export class LeadScoutWorker {
  private readonly repository: WorkerRepository;
  private readonly provider: LeadScoutProvider;
  private readonly matcher: Matcher;
  private readonly cancellationPollMs: number;
  private readonly leaseMs: number;
  private readonly leaseHeartbeatMs: number;

  constructor(options: {
    repository?: WorkerRepository;
    provider?: LeadScoutProvider;
    matcher?: Matcher;
    cancellationPollMs?: number;
    leaseMs?: number;
    leaseHeartbeatMs?: number;
  } = {}) {
    this.repository = options.repository ?? new LeadScoutRepository();
    this.provider = options.provider ?? new OpenAiLeadScoutProvider();
    this.matcher = options.matcher ?? ((events) => matchRelatedEventsAgainstCrm(db, events));
    this.cancellationPollMs = Math.max(1, options.cancellationPollMs ?? 500);
    this.leaseMs = Math.max(5_000, options.leaseMs ?? 60_000);
    this.leaseHeartbeatMs = Math.max(1_000, Math.min(options.leaseHeartbeatMs ?? 10_000, Math.floor(this.leaseMs / 2)));
  }

  private async cancelled(runId: string) {
    return this.repository.isCancellationRequested(runId);
  }

  private async providerCall<T>(
    runId: string,
    workerId: string,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    if (await this.cancelled(runId)) controller.abort();
    const cancelTimer = setInterval(() => {
      void this.cancelled(runId)
        .then((cancelled) => { if (cancelled) controller.abort(); })
        .catch(() => undefined);
    }, this.cancellationPollMs);
    const leaseTimer = setInterval(() => {
      void this.repository.renewLease(runId, workerId, new Date(), this.leaseMs).catch(() => undefined);
    }, this.leaseHeartbeatMs);
    try {
      return await operation(controller.signal);
    } finally {
      clearInterval(cancelTimer);
      clearInterval(leaseTimer);
    }
  }

  async runOne(input: { workerId: string; now: Date }): Promise<{ kind: "idle" | "progress" }> {
    const claim = await this.repository.claimRunnable({
      workerId: input.workerId,
      now: input.now,
      leaseMs: this.leaseMs,
    });
    if (!claim) return { kind: "idle" };

    if (claim.status === "stopping" || await this.cancelled(claim.runId)) {
      await this.repository.stopRun(claim.runId);
      return { kind: "progress" };
    }

    try {
      if (claim.stage === "source_discovery") {
        const sources = await this.providerCall(claim.runId, claim.workerId, (signal) =>
          this.provider.discoverSources(claim.criteria, signal));
        await this.repository.upsertSources(claim.runId, sources);
        if (await this.cancelled(claim.runId)) {
          await this.repository.stopRun(claim.runId);
          return { kind: "progress" };
        }
        await this.repository.updateProgress(claim.runId, {
          stage: "candidate_discovery",
          label: "Checking candidate events",
          sourcesChecked: sources.length,
        });
        return { kind: "progress" };
      }

      if (claim.stage === "candidate_discovery") {
        const run = await this.repository.getRun({ actorId: claim.actorId, runId: claim.runId });
        if (!run) throw new Error("Lead Scout run disappeared during candidate discovery.");
        const sources: LeadScoutSourceInput[] = run.sources.map((source) => ({ ...source, excerpt: "" }));
        const candidates = await this.providerCall(claim.runId, claim.workerId, (signal) =>
          this.provider.discoverCandidates({ criteria: claim.criteria, sources, signal }));
        await this.repository.upsertCandidates(claim.runId, candidates);
        if (await this.cancelled(claim.runId)) {
          await this.repository.stopRun(claim.runId);
          return { kind: "progress" };
        }
        await this.repository.updateProgress(claim.runId, {
          stage: "crm_compare",
          label: "Comparing with Command Center",
          candidatesFound: candidates.length,
          candidatesCompared: 0,
        });
        return { kind: "progress" };
      }

      if (claim.stage === "crm_compare") {
        const run = await this.repository.getRun({ actorId: claim.actorId, runId: claim.runId });
        if (!run) throw new Error("Lead Scout run disappeared during CRM comparison.");
        const index = run.progress.candidatesCompared;
        const candidate = run.candidates[index];
        if (!candidate) {
          await this.repository.updateProgress(claim.runId, { stage: "fit_rank", label: "Ranking Adventure Zone fit" });
          return { kind: "progress" };
        }
        if (await this.cancelled(claim.runId)) {
          await this.repository.stopRun(claim.runId);
          return { kind: "progress" };
        }
        const event = candidateEvent(candidate);
        const match = event
          ? (await this.matcher([event]))[0]?.crmMatch ?? { status: "new_prospect" as const }
          : { status: "new_prospect" as const };
        await this.repository.setCandidateCrmMatch(claim.runId, candidate.id, match);
        const compared = index + 1;
        await this.repository.updateProgress(claim.runId, {
          candidatesCompared: compared,
          stage: compared >= run.candidates.length ? "fit_rank" : "crm_compare",
          label: compared >= run.candidates.length ? "Ranking Adventure Zone fit" : "Comparing with Command Center",
        });
        return { kind: "progress" };
      }

      if (claim.stage === "fit_rank") {
        const run = await this.repository.getRun({ actorId: claim.actorId, runId: claim.runId });
        if (!run) throw new Error("Lead Scout run disappeared during fit ranking.");
        const candidate = run.candidates.find((item) => item.fitScore == null);
        if (!candidate) {
          await this.repository.completeRun(claim.runId);
          return { kind: "progress" };
        }
        const fit = baselineFit(candidate, claim.criteria.regions);
        await this.repository.setCandidateFit(claim.runId, candidate.id, fit);
        return { kind: "progress" };
      }

      if (claim.stage === "complete") {
        await this.repository.completeRun(claim.runId);
        return { kind: "progress" };
      }

      throw new Error(`Unsupported Lead Scout worker stage: ${claim.stage}`);
    } catch (error) {
      if (await this.cancelled(claim.runId) || (error instanceof Error && error.name === "AbortError")) {
        await this.repository.stopRun(claim.runId);
        return { kind: "progress" };
      }
      const message = error instanceof Error ? error.message : "Lead Scout worker failed.";
      await this.repository.failRun(claim.runId, message);
      return { kind: "progress" };
    }
  }
}
