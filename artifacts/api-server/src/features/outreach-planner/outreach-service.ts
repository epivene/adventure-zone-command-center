import {
  saveRouteAnchor,
  reviewImportedClaimSource,
  revokeRouteAnchor,
  reconcileCommittedDemand,
  changeCommitment,
} from "./outreach-allocation-actions";
import { hasActivePursuit } from "./outreach-active-pursuit";
import { z } from "zod";
import type { OutreachAllocation } from "./outreach-allocation";
import { holdExpiryInput } from "./outreach-dto";
import type { AllocationCheckDTO } from "./outreach-dto";
import {
  fingerprint,
  loadAllocationFacts,
  canonicalPackageQuantities,
  type AllocationFacts,
} from "./outreach-capacity-evidence";
import { OutreachRepository, OutreachError } from "./outreach-repository";
import {
  openingInput,
  candidateInput,
  candidatePatch,
  attemptInput,
  researchInput,
  historyReviewInput,
  type PlannerDTO,
  type CandidateDTO,
} from "./outreach-dto";
export const isOutreachPlannerEnabled = () =>
  process.env.OUTREACH_PLANNER_ENABLED === "true";
export class OutreachService {
  constructor(
    readonly repository: OutreachRepository,
    readonly enabled = isOutreachPlannerEnabled,
    readonly clock = () => new Date(),
    readonly allocation?: OutreachAllocation,
  ) {}
  gate() {
    if (!this.enabled())
      throw new OutreachError(404, "Outreach planner is disabled.");
  }
  async get(): Promise<PlannerDTO> {
    if (!this.enabled())
      return {
        enabled: false,
        openings: [],
        candidates: [],
        researchTasks: [],
        legs: [],
        packages: [],
      };
    const now = this.clock();
    const planner = await this.repository.load(now);
    if (
      this.allocation &&
      planner.candidates.some((c) => c.sourceSnapshot?.allocationCheck)
    ) {
      // Shared database-only freshness check; GET never contacts providers.
      let currentFingerprint: string | null = null;
      let currentFacts: AllocationFacts | null = null;
      try {
        currentFacts = await loadAllocationFacts(this.repository.db);
        currentFingerprint = fingerprint(currentFacts);
      } catch {
        /* stale, actionable */
      }
      for (const c of planner.candidates) {
        const saved = c.sourceSnapshot?.allocationCheck as
          AllocationCheckDTO | undefined;
        if (!saved) continue;
        const opening = planner.openings.find((o) => o.id === c.openingId);
        const openingQuantities = canonicalPackageQuantities(
          opening?.quantities ?? {},
        );
        const current =
          !c.releasedAt &&
          opening?.status === "open" &&
          !!saved.target &&
          saved.target.eventStartsOn >= opening.startsOn &&
          saved.target.eventEndsOn <= opening.endsOn &&
          saved.target.legId === opening.legId &&
          Object.entries(
            canonicalPackageQuantities(saved.target.quantities),
          ).every(([code, q]) => (openingQuantities[code] ?? 0) >= q) &&
          !!currentFingerprint &&
          currentFingerprint === saved.provenance.factsFingerprint &&
          new Date(saved.checkedAt) <= now &&
          // Lazy expiry changes effective route/capacity evidence without a DB
          // write. Include all previously live holds, not just this candidate's.
          !currentFacts?.holds.some(
            (h) =>
              h.state === "active" &&
              new Date(h.expires_at) > new Date(saved.checkedAt) &&
              new Date(h.expires_at) <= now,
          ) &&
          !(currentFacts?.anchors ?? []).some(
            (a) =>
              !a.revoked_at &&
              new Date(a.valid_until) > new Date(saved.checkedAt) &&
              new Date(a.valid_until) <= now,
          ) &&
          !!saved.provenance.calendarExpiresAt &&
          new Date(saved.provenance.calendarExpiresAt) > now;
        c.lastAllocationCheck = {
          ...saved,
          freshness: current ? "current" : "stale",
          capacity: current
            ? saved.capacity
            : {
                status: "needs_review",
                reasons: [
                  "Saved allocation check is stale; run a fresh check.",
                ],
              },
        };
      }
    }
    return planner;
  }
  async createOpening(body: unknown, actor: string) {
    this.gate();
    const input = openingInput.parse(body);
    return this.repository.transaction(actor, "create_opening", async (r) => {
      const value = await r.opening(input);
      return { id: value.id, value };
    });
  }
  async createCandidate(body: unknown, actor: string) {
    this.gate();
    const input = candidateInput.parse(body);
    if (input.tier === "convention" && !input.reason)
      throw new OutreachError(
        400,
        "Manual convention classification requires a reason.",
      );
    return this.repository.transaction(actor, "create_candidate", async (r) => {
      const value = await r.candidate(input);
      return {
        id: value.id,
        value: { ...value, reason: input.reason },
        opportunityId: value.opportunityId,
      };
    });
  }
  private async find(r: OutreachRepository, id: string): Promise<CandidateDTO> {
    const c = (await r.load(this.clock())).candidates.find((c) => c.id === id);
    if (!c) throw new OutreachError(404, "Candidate not found.");
    return c;
  }
  async patchCandidate(id: string, body: unknown, actor: string) {
    this.gate();
    const input = candidatePatch.parse(body);
    if (
      input.meaningfulReplyAt &&
      new Date(input.meaningfulReplyAt) > this.clock()
    )
      throw new OutreachError(400, "Reply cannot be in the future.");
    return this.repository.transaction(actor, "edit_candidate", async (r) => {
      const c = await this.find(r, id);
      if (c.releasedAt)
        throw new OutreachError(409, "Released candidate cannot be edited.");
      // Reordering must never displace an existing pursuit, including a callback or reply.
      if (input.manualRank !== undefined || input.tier !== undefined) {
        const rows = (await r.load(this.clock())).candidates;
        if (
          rows.some(
            (x) =>
              x.openingId === c.openingId &&
              !x.releasedAt &&
              (input.manualRank !== undefined || x.id !== c.id) &&
              hasActivePursuit(x),
          )
        )
          throw new OutreachError(
            409,
            "An active pursuit exists; release it through the reviewed advancement action before reranking.",
          );
      }
      const value = await r.patch(id, input);
      return { id, value, opportunityId: c.opportunityId };
    });
  }
  async recordAttempt(id: string, body: unknown, actor: string) {
    this.gate();
    const input = attemptInput.parse(body);
    return this.repository.transaction(
      actor,
      "link_outreach_evidence",
      async (r) => {
        const c = await this.find(r, id);
        if (c.releasedAt)
          throw new OutreachError(409, "Candidate has already been released.");
        const source = c.sources.choices.find((s) => s.id === input.sourceId);
        const confirmedCall =
          !!source?.requiresEventYearConfirmation &&
          input.confirmedEventYear === c.eventYear &&
          !!input.reason;
        if (
          (!source?.eligible && !confirmedCall) ||
          !source ||
          new Date(source.occurredAt) > this.clock()
        )
          throw new OutreachError(
            409,
            "Select a verified successful send or completed outgoing call for this event year.",
          );
        if (
          (source.purpose === "new_outreach" && input.stage !== "initial") ||
          (source.purpose === "follow_up" && input.stage === "initial")
        )
          throw new OutreachError(
            409,
            "Source purpose does not match the selected stage.",
          );
        const stages = ["initial", "follow_up_1", "follow_up_2"];
        if (
          input.stage !== stages[c.attempts.length] ||
          c.attempts.some((a) => a.occurredAt >= source.occurredAt)
        )
          throw new OutreachError(
            409,
            "Link initial outreach and follow-ups in chronological stage order.",
          );
        // Evidence linkage records history only; it never sends or changes user callbacks.
        const value = await r.attempt(id, input, source.occurredAt, actor);
        return {
          id,
          value: {
            ...value,
            confirmedEventYear: input.confirmedEventYear,
            reason: input.reason,
          },
          opportunityId: c.opportunityId,
        };
      },
    );
  }
  async advance(id: string, actor: string) {
    this.gate();
    return this.repository.transaction(actor, "release_pursuit", async (r) => {
      const c = await this.find(r, id);
      if (
        c.releasedAt ||
        c.liveHoldId ||
        c.waitingForCandidateId ||
        c.outreach.state !== "advance"
      )
        throw new OutreachError(
          409,
          "Only the leading pursuit with all completed cadence stages may advance.",
        );
      if (
        c.sources.manualNextActions.length ||
        c.sources.reviewReasons.length ||
        c.sources.protectedReason
      )
        throw new OutreachError(
          409,
          "Resolve existing callbacks and verify reply history before releasing this pursuit.",
        );
      const value = await r.release(id, this.clock());
      return { id, value, opportunityId: c.opportunityId };
    });
  }
  async check(id: string, actor: string) {
    this.gate();
    const allocationCheck = await this.allocation?.evaluateCandidate(id);
    return this.repository.transaction(actor, "check_sources", async (r) => {
      const c = await this.find(r, id);
      if (allocationCheck) {
        c.sources.capacity = allocationCheck.capacity;
        c.sources.allocationCheck = allocationCheck;
      }
      await r.check(id, c.sources);
      return { id, value: c.sources, opportunityId: c.opportunityId };
    });
  }
  async sources(id: string) {
    this.gate();
    const sources = (await this.find(this.repository, id)).sources;
    if (this.allocation) {
      sources.allocationCheck = await this.allocation.evaluateCandidate(id);
      sources.capacity = sources.allocationCheck.capacity;
    }
    return sources;
  }
  private requireAllocation() {
    this.gate();
    if (!this.allocation)
      throw new OutreachError(
        409,
        "Allocation evidence provider is unavailable.",
      );
    return this.allocation;
  }
  async reviewImportedClaimSource(id: string, body: unknown, actor: string) {
    return reviewImportedClaimSource(this.requireAllocation(), id, body, actor);
  }
  async saveRouteAnchor(body: unknown, actor: string) {
    return saveRouteAnchor(this.requireAllocation(), body, actor);
  }
  async revokeRouteAnchor(id: string, body: unknown, actor: string) {
    return revokeRouteAnchor(this.requireAllocation(), id, body, actor);
  }
  async reconcileCommittedDemand(id: string, body: unknown, actor: string) {
    return reconcileCommittedDemand(this.requireAllocation(), id, body, actor);
  }
  async changeCommitment(id: string, body: unknown, actor: string) {
    return changeCommitment(this.requireAllocation(), id, body, actor);
  }
  async allocations() {
    return this.requireAllocation().list();
  }
  async saveDemand(id: string, body: unknown, actor: string) {
    return this.requireAllocation().saveDemand(id, body, actor);
  }
  async createHold(id: string, body: unknown, actor: string) {
    const allocation = this.requireAllocation();
    return allocation.createHold(
      id,
      holdExpiryInput.parse(body).expiresAt,
      actor,
    );
  }
  async releaseHold(id: string, actor: string) {
    return this.requireAllocation().releaseHold(id, actor);
  }
  async extendHold(id: string, body: unknown, actor: string) {
    const allocation = this.requireAllocation();
    return allocation.extendHold(
      id,
      holdExpiryInput.parse(body).expiresAt,
      actor,
    );
  }
  async research(id: string, body: unknown, actor: string) {
    this.gate();
    const { criteria } = researchInput.parse(body);
    return this.repository.transaction(actor, "create_research", async (r) => {
      const opening = (await r.load(this.clock())).openings.find(
        (x) => x.id === id,
      );
      if (!opening) throw new OutreachError(404, "Opening not found.");
      const derived = `${opening.eventYear}; ${opening.startsOn} to ${opening.endsOn}; leg ${opening.legId ?? "unassigned"}; packages ${JSON.stringify(opening.quantities)}\n${criteria}`;
      const value = await r.research(id, derived);
      return { id: value.id, value };
    });
  }
  async reviewHistory(id: string, body: unknown, actor: string) {
    this.gate();
    const { reason } = historyReviewInput.parse(body);
    return this.repository.transaction(actor, "review_history", async (r) => {
      const c = await this.find(r, id);
      if (c.sources.historyFingerprint === "unverified")
        throw new OutreachError(
          409,
          "Sources unavailable; retry before reviewing history.",
        );
      const value = await r.reviewHistory(
        id,
        reason,
        c.sources.historyFingerprint,
        this.clock(),
      );
      return { id, value, opportunityId: c.opportunityId };
    });
  }
  async setOpeningStatus(id: string, body: unknown, actor: string) {
    this.gate();
    const { status, reason } = z
      .object({
        status: z.enum(["open", "filled", "closed"]),
        reason: z.string().trim().min(1),
      })
      .strict()
      .parse(body);
    return this.repository.transaction(actor, "opening_status", async (r) => {
      const value = await r.openingStatus(id, status);
      return { id, value: { ...value, reason } };
    });
  }
  async searchOpportunities(query: unknown) {
    this.gate();
    const { q, year } = z
      .object({
        q: z.string().trim().max(200).default(""),
        year: z.coerce.number().int().min(2000).max(2200),
      })
      .parse(query);
    return this.repository.opportunities(q, year);
  }
  async saveResearchResults(id: string, body: unknown, actor: string) {
    this.gate();
    const { results } = z
      .object({
        results: z
          .array(
            z
              .object({
                opportunityId: z.string().uuid(),
                sourceUrl: z.string().url(),
                note: z.string().trim().min(1),
              })
              .strict(),
          )
          .min(1)
          .max(100),
      })
      .strict()
      .parse(body);
    return this.repository.transaction(actor, "research_results", async (r) => {
      const value = await r.researchResults(id, results);
      return { id, value };
    });
  }
}
