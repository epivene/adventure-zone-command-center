import { rowsOf } from "./outreach-sources";
import { searchProfiles, admitProfile, bindOpportunityToBooking } from "./outreach-workspace";
import { applyPortfolioPriority } from "./outreach-portfolio";
import { sql } from "drizzle-orm";
import { replayActualOutreach } from "./outreach-events";
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
  profileAdmissionInput,
  opportunityBindingInput,
  researchResultInput,
  candidateInput,
  candidatePatch,
  attemptInput,
  researchInput,
  historyReviewInput,
  type PlannerDTO,
  type RecoveryCatalogDTO,
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
    await replayActualOutreach(this.repository.db).catch(() => undefined);
    const now = this.clock();
    const planner = await this.repository.load(now);
    let portfolioFacts: AllocationFacts | null = null;
    if (
      this.allocation &&
      planner.candidates.some((c) => c.sourceSnapshot?.allocationCheck)
    ) {
      // Shared database-only freshness check; GET never contacts providers.
      let currentFingerprint: string | null = null;
      let currentFacts: AllocationFacts | null = null;
      try {
        currentFacts = await loadAllocationFacts(this.repository.db);
        portfolioFacts = currentFacts;
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
        c.capacity = c.lastAllocationCheck.capacity;
      }
    }
    const labels = [
      ...planner.packages.flatMap((p) => [
        [p.id, p.name],
        [p.code, p.name],
      ]),
      ...planner.legs.map((l) => [l.id, l.name]),
      ...(portfolioFacts?.bookings ?? []).map((b) => [b.id, b.name]),
      ...(portfolioFacts?.resources ?? []).map((r) => [r.id, r.name]),
    ];
    for (const c of planner.candidates)
      c.capacityDisplayReasons = c.capacity.reasons.map((reason) =>
        labels.reduce((text, [id, name]) => text.replaceAll(id, name), reason),
      );
    applyPortfolioPriority(planner, portfolioFacts, now);
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
          (source.explicitStage && source.explicitStage !== input.stage) ||
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
  async reviewActualSource(id: string, body: unknown, actor: string) {
    this.gate();
    const input = z
      .object({
        sourceId: z.string().trim().min(1),
        classification: z.enum(["additional_attempt", "not_cadence"]),
        confirmedEventYear: z.number().int().optional(),
        reason: z.string().trim().min(1).max(2000),
      })
      .strict()
      .parse(body);
    return this.repository.transaction(
      actor,
      "review_actual_outreach_source",
      async (r) => {
        const c = await this.find(r, id),
          source = c.sources.choices.find((s) => s.id === input.sourceId);
        if (
          !source ||
          (!source.eligible &&
            !(
              source.requiresEventYearConfirmation &&
              input.confirmedEventYear === c.eventYear
            )) ||
          new Date(source.occurredAt) > this.clock() ||
          c.attempts.some((a) => a.sourceId === source.id)
        )
          throw new OutreachError(
            409,
            "Select an unlinked actual outgoing source and verify its exact event year.",
          );
        if (
          input.classification === "additional_attempt" &&
          c.attempts.length !== 3
        )
          throw new OutreachError(
            409,
            "Link the initial outreach and two follow-up stages first.",
          );
        await r.db.execute(
          sql`insert into outreach_source_reviews(candidate_id,source_id,classification,occurred_at,actor,reason) values (${id}::uuid,${source.id},${input.classification},${new Date(source.occurredAt)},${actor},${input.reason}) on conflict(candidate_id,source_id) do update set classification=excluded.classification,occurred_at=excluded.occurred_at,actor=excluded.actor,reason=excluded.reason,reviewed_at=now()`,
        );
        return {
          id,
          value: { ...input, occurredAt: source.occurredAt },
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
    const input = researchInput.parse(body);
    return this.repository.transaction(actor, "create_research", async (r) => {
      const opening = (await r.load(this.clock())).openings.find(
        (x) => x.id === id,
      );
      if (!opening) throw new OutreachError(404, "Opening not found.");
      if (
        input.qualificationCriteria.startsOn < opening.startsOn ||
        input.qualificationCriteria.endsOn > opening.endsOn ||
        Object.entries(input.qualificationCriteria.quantities).some(
          ([code, q]) => (opening.quantities[code] ?? 0) < q,
        )
      )
        throw new OutreachError(
          400,
          "Research dates and packages must fit the selected opening criteria.",
        );
      const value = await r.research(id, input, this.clock());
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
  async recoveryCatalog(query: unknown): Promise<RecoveryCatalogDTO> {
    this.gate();
    const { q } = z
      .object({ q: z.string().trim().max(200).default("") })
      .parse(query);
    const bookings = rowsOf<RecoveryCatalogDTO["bookings"][number]>(
      await this.repository.db.execute(
        sql`select b.id,b.organization_id as "organizationId",g.name as "organizationName",b.name,b.starts_at as "startsAt",b.ends_at as "endsAt",b.status,b.travel_leg_id as "travelLegId" from bookings b left join organizations g on g.id=b.organization_id where b.name ilike ${`%${q}%`} or g.name ilike ${`%${q}%`} order by b.starts_at desc nulls last,b.id limit 100`,
      ),
    );
    const drafts = rowsOf<RecoveryCatalogDTO["drafts"][number]>(
      await this.repository.db.execute(
        sql`select d.id,'opportunity_email' as kind,d.organization_id as "organizationId",d.opportunity_id as "opportunityId",o.booking_id as "bookingId",d.event_year as "eventYear",d.subject,d.recipient_email as "recipientEmail",d.state from booking_opportunity_email_state d join booking_opportunities o on o.id=d.opportunity_id join organizations g on g.id=d.organization_id where d.state not in ('sent','discarded') and (g.name ilike ${`%${q}%`} or d.subject ilike ${`%${q}%`}) union all select d.id,'office_email',d.organization_id,o.id,d.booking_id,d.event_year,d.subject,d.recipient_email,d.state from office_email_drafts d join organizations g on g.id=d.organization_id left join booking_opportunities o on o.organization_id=d.organization_id and o.event_year=d.event_year and (d.booking_id is null or o.booking_id=d.booking_id) where d.state not in ('sent','discarded') and (g.name ilike ${`%${q}%`} or d.subject ilike ${`%${q}%`}) limit 100`,
      ),
    );
    return JSON.parse(
      JSON.stringify({ bookings, drafts }),
    ) as RecoveryCatalogDTO;
  }
  async searchProfiles(query: unknown) {
    this.gate();
    const { q, year } = z
      .object({
        q: z.string().trim().max(200).default(""),
        year: z.coerce.number().int().min(2000).max(2200),
      })
      .parse(query);
    return searchProfiles(this.repository, q, year);
  }
  async admitProfile(body: unknown, actor: string) {
    this.gate();
    const input = profileAdmissionInput.parse(body);
    return this.repository.transaction(
      actor,
      "admit_profile_year",
      async (r) => {
        const value = await admitProfile(r, input);
        return {
          id: value.opportunityId,
          value,
          opportunityId: value.opportunityId,
        };
      },
    );
  }
  async bindOpportunity(id: string, body: unknown, actor: string) {
    this.gate();
    const opportunityId = z.string().uuid().parse(id);
    const input = opportunityBindingInput.parse(body);
    return this.repository.transaction(actor, "bind_opportunity_booking", async (r) => {
      const value = await bindOpportunityToBooking(r, opportunityId, input);
      return { id: opportunityId, value, opportunityId };
    });
  }
  async saveResearchResults(id: string, body: unknown, actor: string) {
    this.gate();
    const { results } = z
      .object({ results: z.array(researchResultInput).min(1).max(100) })
      .strict()
      .parse(body);
    return this.repository.transaction(actor, "research_results", async (r) => {
      const value = await r.researchResults(id, results, this.clock());
      return { id, value };
    });
  }
}
