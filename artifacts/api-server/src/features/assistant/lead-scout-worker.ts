import { db } from "@workspace/db";

import {
  matchRelatedEventsAgainstCrm,
  type RelatedEventCrmMatch,
} from "@/features/profile-research/profile-research-related-event-matcher";
import type { RelatedEventOpportunity } from "@/features/profile-research/profile-research-discovery";
import { isOperationallyReliableFact, selectBestFact } from "./lead-scout-evidence";
import { scoreAdventureZoneFit } from "./lead-scout-fit";
import { classifyAttendanceScale, isAdultSpecialInterestEvent } from "./lead-scout-priority";
import { LeadScoutRepository } from "./lead-scout-repository";
import { OpenAiLeadScoutProvider } from "./openai-lead-scout-provider";
import type { LeadScoutProvider } from "./lead-scout-provider";
import type {
  LeadScoutCandidateInput,
  LeadScoutCandidateView,
  LeadScoutEvidenceFact,
  LeadScoutSourceInput,
} from "./lead-scout-types";

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
  | "replaceCandidateFacts"
  | "startCandidateEnrichment"
  | "completeCandidateEnrichment"
  | "failCandidateEnrichment"
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

function candidateInput(candidate: LeadScoutCandidateView): LeadScoutCandidateInput {
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

function contains(facts: LeadScoutEvidenceFact[], pattern: RegExp) {
  return facts.some((fact) => pattern.test(`${fact.key} ${fact.value} ${fact.rationale}`));
}

function selectedByCategory(
  facts: LeadScoutEvidenceFact[],
  sources: LeadScoutSourceInput[],
  category: LeadScoutEvidenceFact["category"],
  keyPattern?: RegExp,
) {
  return selectBestFact(
    facts.filter((fact) => fact.category === category && (!keyPattern || keyPattern.test(fact.key))),
    sources,
  );
}

function reliableSelected(
  facts: LeadScoutEvidenceFact[],
  sources: LeadScoutSourceInput[],
  category: LeadScoutEvidenceFact["category"],
  keyPattern?: RegExp,
) {
  const selected = selectedByCategory(facts, sources, category, keyPattern);
  return isOperationallyReliableFact(selected, sources) ? selected : null;
}

function evidenceSummary(facts: LeadScoutEvidenceFact[], sources: LeadScoutSourceInput[]) {
  const organizerName = reliableSelected(facts, sources, "contact", /organizer.*name|contact.*name/i)?.value ?? null;
  const organizerEmail = reliableSelected(facts, sources, "contact", /email/i)?.value ?? null;
  const organizerPhone = reliableSelected(facts, sources, "contact", /phone|telephone/i)?.value ?? null;
  const attendanceSummary = reliableSelected(facts, sources, "attendance")?.value ?? null;
  const vendorSummary = reliableSelected(facts, sources, "vendor", /path|application|vendor|exhibitor|booth/i)?.value
    ?? reliableSelected(facts, sources, "vendor")?.value
    ?? null;
  const recurrenceSummary = reliableSelected(facts, sources, "recurrence")?.value ?? null;
  const deadline = reliableSelected(facts, sources, "vendor", /deadline/i)?.value ?? null;
  const applicationDeadline = deadline && /^\d{4}-\d{2}-\d{2}$/.test(deadline) ? deadline : null;
  return { organizerName, organizerEmail, organizerPhone, attendanceSummary, vendorSummary, recurrenceSummary, applicationDeadline };
}

function evidenceFit(
  candidate: LeadScoutCandidateView,
  facts: LeadScoutEvidenceFact[],
  sources: LeadScoutSourceInput[],
  now: Date,
) {
  const schedule = selectedByCategory(facts, sources, "schedule");
  const identity = selectedByCategory(facts, sources, "identity");
  const existenceConfidence = schedule?.confidence ?? identity?.confidence ?? (candidate.startsAt ? "medium" : "low");
  const deadline = reliableSelected(facts, sources, "vendor", /deadline/i)?.value ?? candidate.applicationDeadline;
  const applicationDeadline = deadline && /^\d{4}-\d{2}-\d{2}$/.test(deadline) ? deadline : null;
  const operationalFacts = facts.filter((fact) => isOperationallyReliableFact(fact, sources));
  const attendanceFact = reliableSelected(facts, sources, "attendance");
  const attendanceScale = classifyAttendanceScale(attendanceFact?.value ?? candidate.attendanceSummary);
  const text = `${candidate.name} ${candidate.eventType ?? ""} ${candidate.venue ?? ""}`;
  return scoreAdventureZoneFit({
    eventName: candidate.name,
    eventType: candidate.eventType,
    startsAt: candidate.startsAt,
    endsAt: candidate.endsAt,
    applicationDeadline,
    now,
    hasPublicSource: Boolean(candidate.website || sources.length),
    hasFamilySignal: /family|kids?|children|all ages|youth|fair|festival/i.test(text) || contains(facts, /family|kids?|children|all ages|youth/i),
    hasAdultSpecialInterestSignal: isAdultSpecialInterestEvent(candidate.name, candidate.eventType),
    hasOutdoorSignal: /outdoor|park|fairground|downtown|street|festival|fair/i.test(text) || contains(facts, /outdoor|space|fairground|park/i),
    hasVendorPath: contains(operationalFacts.filter((fact) => fact.category === "vendor"), /vendor|exhibitor|application|booth|participat/i),
    hasEntertainmentPath: contains(operationalFacts, /entertainment|attraction|amusement|carnival|inflatable|ride/i),
    hasOrganizerContact: operationalFacts.some((fact) => fact.category === "contact"),
    hasAttendanceEvidence: Boolean(attendanceFact),
    attendanceScale,
    hasLogisticsEvidence: operationalFacts.some((fact) => fact.category === "logistics"),
    hasExclusiveCarnivalProvider: contains(operationalFacts.filter((fact) => fact.category === "competition"), /exclusive|incumbent|contracted|midway|carnival provider/i),
    existenceConfidence,
  });
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

  private async providerCall<T>(runId: string, workerId: string, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    if (await this.cancelled(runId)) controller.abort();
    const cancelTimer = setInterval(() => {
      void this.cancelled(runId).then((cancelled) => { if (cancelled) controller.abort(); }).catch(() => undefined);
    }, this.cancellationPollMs);
    const leaseTimer = setInterval(() => {
      void this.repository.renewLease(runId, workerId, new Date(), this.leaseMs).catch(() => undefined);
    }, this.leaseHeartbeatMs);
    try { return await operation(controller.signal); }
    finally { clearInterval(cancelTimer); clearInterval(leaseTimer); }
  }

  async runOne(input: { workerId: string; now: Date }): Promise<{ kind: "idle" | "progress" }> {
    const claim = await this.repository.claimRunnable({ workerId: input.workerId, now: input.now, leaseMs: this.leaseMs });
    if (!claim) return { kind: "idle" };
    if (claim.status === "stopping" || await this.cancelled(claim.runId)) {
      await this.repository.stopRun(claim.runId);
      return { kind: "progress" };
    }

    try {
      if (claim.stage === "source_discovery") {
        const sources = await this.providerCall(claim.runId, claim.workerId, (signal) => this.provider.discoverSources(claim.criteria, signal));
        await this.repository.upsertSources(claim.runId, sources);
        if (await this.cancelled(claim.runId)) { await this.repository.stopRun(claim.runId); return { kind: "progress" }; }
        await this.repository.updateProgress(claim.runId, { stage: "candidate_discovery", label: "Checking candidate events", sourcesChecked: sources.length });
        return { kind: "progress" };
      }

      if (claim.stage === "candidate_discovery") {
        const run = await this.repository.getRun({ actorId: claim.actorId, runId: claim.runId });
        if (!run) throw new Error("Lead Scout run disappeared during candidate discovery.");
        const sources: LeadScoutSourceInput[] = run.sources.map((source) => ({ ...source, excerpt: "" }));
        const candidates = await this.providerCall(claim.runId, claim.workerId, (signal) =>
          this.provider.discoverCandidates({ criteria: claim.criteria, sources, signal }));
        await this.repository.upsertCandidates(claim.runId, candidates);
        if (await this.cancelled(claim.runId)) { await this.repository.stopRun(claim.runId); return { kind: "progress" }; }
        await this.repository.updateProgress(claim.runId, { stage: "crm_compare", label: "Comparing with Command Center", candidatesFound: candidates.length, candidatesCompared: 0 });
        return { kind: "progress" };
      }

      if (claim.stage === "crm_compare") {
        const run = await this.repository.getRun({ actorId: claim.actorId, runId: claim.runId });
        if (!run) throw new Error("Lead Scout run disappeared during CRM comparison.");
        const index = run.progress.candidatesCompared;
        const candidate = run.candidates[index];
        if (!candidate) {
          await this.repository.updateProgress(claim.runId, { stage: "candidate_enrichment", label: "Researching candidate details" });
          return { kind: "progress" };
        }
        if (await this.cancelled(claim.runId)) { await this.repository.stopRun(claim.runId); return { kind: "progress" }; }
        const event = candidateEvent(candidate);
        const match = event ? (await this.matcher([event]))[0]?.crmMatch ?? { status: "new_prospect" as const } : { status: "new_prospect" as const };
        await this.repository.setCandidateCrmMatch(claim.runId, candidate.id, match);
        const compared = index + 1;
        await this.repository.updateProgress(claim.runId, {
          candidatesCompared: compared,
          stage: compared >= run.candidates.length ? "candidate_enrichment" : "crm_compare",
          label: compared >= run.candidates.length ? "Researching candidate details" : "Comparing with Command Center",
        });
        return { kind: "progress" };
      }

      if (claim.stage === "candidate_enrichment") {
        const run = await this.repository.getRun({ actorId: claim.actorId, runId: claim.runId });
        if (!run) throw new Error("Lead Scout run disappeared during candidate enrichment.");
        const candidate = run.candidates.find((item) => item.enrichmentStatus === "needs_enrichment");
        if (!candidate) {
          await this.repository.updateProgress(claim.runId, { stage: "fit_rank", label: "Finishing prospect ranking" });
          return { kind: "progress" };
        }
        if (await this.cancelled(claim.runId)) { await this.repository.stopRun(claim.runId); return { kind: "progress" }; }
        if (!await this.repository.startCandidateEnrichment(claim.runId, candidate.id)) return { kind: "progress" };
        const knownSources: LeadScoutSourceInput[] = run.sources.map((source) => ({ ...source, excerpt: "" }));
        if (candidate.website && !knownSources.some((source) => source.url === candidate.website)) {
          knownSources.push({
            url: candidate.website,
            title: `${candidate.name} event page`,
            publisher: null,
            category: "other",
            retrievedAt: input.now.toISOString(),
            excerpt: "Candidate event page discovered by Lead Scout.",
          });
        }
        try {
          const enrichment = await this.providerCall(claim.runId, claim.workerId, (signal) =>
            this.provider.enrichCandidate({ criteria: claim.criteria, candidate: candidateInput(candidate), knownSources, signal }));
          await this.repository.upsertSources(claim.runId, enrichment.sources);
          await this.repository.replaceCandidateFacts(claim.runId, candidate.id, enrichment.facts);
          const allSources = [...knownSources, ...enrichment.sources];
          const summary = evidenceSummary(enrichment.facts, allSources);
          await this.repository.completeCandidateEnrichment(claim.runId, candidate.id, { coverageGaps: enrichment.coverageGaps, ...summary });
          const fit = evidenceFit(candidate, enrichment.facts, allSources, input.now);
          await this.repository.setCandidateFit(claim.runId, candidate.id, {
            ...fit,
            rationale: [...fit.reasons, ...fit.cautions].join("; ") || "Needs more research before ranking.",
          });
          await this.repository.updateProgress(claim.runId, {
            candidatesEnriched: run.progress.candidatesEnriched + 1,
            label: "Researching candidate details",
          });
        } catch (error) {
          if (await this.cancelled(claim.runId) || (error instanceof Error && error.name === "AbortError")) throw error;
          await this.repository.failCandidateEnrichment(
            claim.runId,
            candidate.id,
            error instanceof Error ? error.message : "Candidate enrichment failed.",
          );
        }
        return { kind: "progress" };
      }

      if (claim.stage === "fit_rank" || claim.stage === "complete") {
        await this.repository.completeRun(claim.runId);
        return { kind: "progress" };
      }

      throw new Error(`Unsupported Lead Scout worker stage: ${claim.stage}`);
    } catch (error) {
      if (await this.cancelled(claim.runId) || (error instanceof Error && error.name === "AbortError")) {
        await this.repository.stopRun(claim.runId);
        return { kind: "progress" };
      }
      await this.repository.failRun(claim.runId, error instanceof Error ? error.message : "Lead Scout worker failed.");
      return { kind: "progress" };
    }
  }
}
