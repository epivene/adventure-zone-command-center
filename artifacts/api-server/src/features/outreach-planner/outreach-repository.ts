import { businessDateKey } from "../../lib/business-date";
import {
  classificationSuggestions,
  qualifiesResearchResult,
} from "./outreach-workspace";
import { outreachContactBlock } from "./outreach-contact-safety";
import { rowsOf } from "./outreach-sources";
import { randomUUID } from "node:crypto";
import { hasActivePursuit } from "./outreach-active-pursuit";
import { eq, sql, ilike, and } from "drizzle-orm";
import type { db as runtimeDb } from "@workspace/db";
import {
  outreachOpenings,
  outreachCandidates,
  outreachAttempts,
  outreachResearchTasks,
  outreachAudit,
  bookingOpportunities,
  organizations,
  travelLegs,
  packageTemplates,
  activities,
  outreachHolds,
} from "../../db/schema";
import type {
  OpeningInput,
  CandidateInput,
  CandidatePatch,
  AttemptInput,
  ResearchInput,
  ResearchResultInput,
  OpportunityChoiceDTO,
  OpeningDTO,
  CandidateDTO,
  PlannerDTO,
  SourcesDTO,
} from "./outreach-dto";
import {
  readOutreachSources,
  OutreachSourceUnavailable,
} from "./outreach-sources";
import { compareOutreachPriority, evaluateOutreach } from "./outreach-policy";
export class OutreachError extends Error {
  constructor(
    public status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}
const json = <T>(v: unknown): T => JSON.parse(JSON.stringify(v));
export class OutreachRepository {
  constructor(readonly db: typeof runtimeDb) {}
  async transaction<T>(
    actor: string,
    action: string,
    work: (
      repo: OutreachRepository,
    ) => Promise<{ id: string; value: T; opportunityId?: string }>,
  ): Promise<T> {
    try {
      return await this.db.transaction(async (tx) => {
        // Serializes all planner ranking/pursuit changes, including cross-opening membership.
        await tx.execute(sql`select pg_advisory_xact_lock(908092026)`);
        const result = await work(
          new OutreachRepository(tx as unknown as typeof runtimeDb),
        );
        const profileActivityId = result.opportunityId ? randomUUID() : null;
        await tx.insert(outreachAudit).values({
          actor,
          action,
          entityId: result.id,
          detail: {
            ...json<Record<string, unknown>>(result.value),
            profileActivityId,
          },
        });
        if (result.opportunityId) {
          const [op] = await tx
            .select()
            .from(bookingOpportunities)
            .where(eq(bookingOpportunities.id, result.opportunityId));
          if (op)
            await tx.insert(activities).values({
              id: profileActivityId!,
              organizationId: op.organizationId,
              contactId: op.contactId,
              bookingId: op.bookingId,
              kind: "note",
              subject: "Outreach planner",
              body: `${action.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase())}.${typeof result.value === "object" && result.value && "reason" in result.value ? ` Reason: ${String(result.value.reason)}` : ""} Recorded by ${actor}.`,
              occurredAt: new Date(),
              timelineSortAt: new Date(),
            });
        }
        return result.value;
      });
    } catch (e) {
      const code =
        (e as { code?: string; cause?: { code?: string } }).code ??
        (e as { cause?: { code?: string } }).cause?.code;
      if (code === "23505")
        throw new OutreachError(
          409,
          "This opportunity, outreach evidence, stage, or research request is already recorded.",
        );
      if (code === "23503")
        throw new OutreachError(
          404,
          "Referenced opening, opportunity or leg no longer exists.",
        );
      if (["23514", "22007", "22008"].includes(code ?? ""))
        throw new OutreachError(400, "Invalid date, rank or planning value.");
      throw e;
    }
  }
  async load(now: Date): Promise<PlannerDTO> {
    const liveHolds =
      process.env.OUTREACH_PLANNER_ENABLED === "true"
        ? await this.db
            .select()
            .from(outreachHolds)
            .where(
              and(
                eq(outreachHolds.state, "active"),
                sql`${outreachHolds.expiresAt} > ${now}`,
              ),
            )
        : [];
    const openings = json<OpeningDTO[]>(
      await this.db.select().from(outreachOpenings),
    );
    const rows = await this.db
      .select({
        candidate: outreachCandidates,
        opportunity: bookingOpportunities,
        organizationName: organizations.name,
        organizationLastResort: organizations.lastResort,
      })
      .from(outreachCandidates)
      .innerJoin(
        bookingOpportunities,
        eq(outreachCandidates.opportunityId, bookingOpportunities.id),
      )
      .innerJoin(
        organizations,
        eq(bookingOpportunities.organizationId, organizations.id),
      );
    const candidates: CandidateDTO[] = [];
    for (const row of rows) {
      const c = row.candidate,
        op = row.opportunity,
        opening = openings.find((o) => o.id === c.openingId)!;
      let sources: SourcesDTO;
      try {
        // A nested transaction is a savepoint during mutations. SQL failures must
        // roll back this read boundary before any planner writes can continue.
        sources = await this.db.transaction((tx) =>
          readOutreachSources(tx, c.opportunityId, opening, now),
        );
      } catch (error) {
        sources =
          error instanceof OutreachSourceUnavailable
            ? error.sources
            : {
                checkedAt: now.toISOString(),
                choices: [],
                historyFingerprint: "unverified",
                reviewReasons: [
                  "Source integration unavailable; retry the check.",
                ],
                protectedReason: null,
                manualNextActions: [],
                capacity: {
                  status: "needs_review",
                  reasons: [
                    "Capacity/calendar/travel sources are not verified.",
                  ],
                },
              };
        // Retain facts already read from core rows even if the adapter failed early.
        if (
          row.organizationLastResort ||
          op.emailAutomationProtected ||
          (op.status === "territory_hold" && !op.territoryExceptionApproved)
        )
          sources.protectedReason =
            "Protected contact or territory hold requires owner review.";
        if (
          op.nextActionDueAt &&
          !sources.manualNextActions.some(
            (x) => x.id === `opportunity:${op.id}`,
          )
        )
          sources.manualNextActions.push({
            id: `opportunity:${op.id}`,
            kind: op.nextActionKind ?? "manual",
            dueAt: op.nextActionDueAt.toISOString(),
          });
      }
      if (
        c.historyReview &&
        c.historyReview.fingerprint === sources.historyFingerprint &&
        sources.historyFingerprint !== "unverified"
      )
        sources.reviewReasons = [];
      if (
        sources.choices.some(
          (source) =>
            !Number.isFinite(new Date(source.occurredAt).getTime()) ||
            new Date(source.occurredAt) > now,
        )
      )
        sources.protectedReason =
          "Source evidence has invalid or future dates; correct the source before routine outreach.";
      const [event] = rowsOf<{
        starts_at: string | null;
        ends_at: string | null;
      }>(
        await this.db.execute(
          sql`select starts_at,ends_at from bookings where id=${op.bookingId}::uuid`,
        ),
      );
      const attempts = json<CandidateDTO["attempts"]>(
        await this.db
          .select()
          .from(outreachAttempts)
          .where(eq(outreachAttempts.candidateId, c.id)),
      );
      sources.sourceReviews =
        process.env.OUTREACH_PLANNER_ENABLED === "true"
          ? rowsOf(
              await this.db.execute(
                sql`select source_id as "sourceId",classification,occurred_at as "occurredAt",reason from outreach_source_reviews where candidate_id=${c.id}::uuid`,
              ),
            )
          : [];
      const pending = sources.choices.filter(
        (s) =>
          (s.eligible || s.requiresEventYearConfirmation) &&
          new Date(s.occurredAt) <= now &&
          !attempts.some((a) => a.sourceId === s.id) &&
          !sources.sourceReviews?.some(
            (r) =>
              r.sourceId === s.id &&
              new Date(r.occurredAt).getTime() ===
                new Date(s.occurredAt).getTime(),
          ),
      );
      sources.pendingSourceReviewIds = pending.map((s) => s.id);
      if (pending.length)
        sources.reviewReasons.push(
          "Actual outreach remains unlinked. Review its event year and cadence stage before advancing.",
        );
      let outreach = evaluateOutreach(
        {
          tier: c.tier,
          status:
            c.releasedAt || opening.status !== "open"
              ? "no_response"
              : op.status,
          attempts: attempts.map((a) => ({
            id: a.sourceId,
            occurredAt: a.occurredAt,
            stage: a.stage,
            successful: true,
          })),
          latestActualAttemptAt:
            sources.sourceReviews
              .filter((r) => r.classification === "additional_attempt")
              .map((r) => new Date(r.occurredAt).toISOString())
              .sort()
              .at(-1) ?? null,
          meaningfulReplyAt:
            c.meaningfulReplyAt?.toISOString() ??
            sources.observedInterestAt ??
            null,
          decisionDueAt: c.decisionDueAt?.toISOString() ?? null,
          conventionEndsOn: c.conventionEndsOn,
          snoozedUntil: c.snoozedUntil?.toISOString() ?? null,
          operationalStartsOn: event?.starts_at
            ? businessDateKey(new Date(event.starts_at))
            : null,
          blockedReason:
            sources.protectedReason ??
            (sources.observedConversationAt &&
            !sources.observedInterestAt &&
            !c.meaningfulReplyAt &&
            !c.decisionDueAt
              ? "A completed conversation needs explicit reply or decision classification."
              : null),
        },
        now,
        c.cadenceOverride ?? undefined,
      );
      if (
        sources.reviewReasons.length &&
        ["ready", "waiting", "follow_up", "advance"].includes(outreach.state) &&
        !c.decisionDueAt
      )
        outreach = {
          ...outreach,
          state: "needs_review",
          nextStage: null,
          reason: sources.reviewReasons.join(" "),
        };
      if (
        sources.manualNextActions.length &&
        !c.decisionDueAt &&
        !sources.protectedReason &&
        !["reply", "closed"].includes(outreach.state)
      ) {
        const manual = sources.manualNextActions
          .slice()
          .sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0];
        outreach = {
          state: new Date(manual.dueAt) <= now ? "decision" : "waiting",
          dueAt: manual.dueAt,
          nextStage: null,
          reason: `Existing ${manual.kind} takes precedence over generic outreach.`,
        };
      }
      candidates.push({
        ...json<Omit<CandidateDTO, "sources">>(c),
        organizationId: op.organizationId,
        bookingId: op.bookingId,
        eventStartsAt: event?.starts_at
          ? new Date(event.starts_at).toISOString()
          : null,
        eventEndsAt: event?.ends_at
          ? new Date(event.ends_at).toISOString()
          : null,
        suggestions: await classificationSuggestions(
          this.db,
          op.organizationId,
        ),
        waitingFor: null,
        portfolio: {
          state: "needs_review",
          reason:
            "Run a current allocation check before selecting first-choice pursuit.",
          competing: [],
        },
        organizationName: row.organizationName,
        eventYear: op.eventYear,
        opportunityStatus: op.status,
        attempts,
        outreach,
        capacity: sources.capacity,
        capacityDisplayReasons: sources.capacity.reasons,
        sources,
        waitingForCandidateId: null,
        liveHoldId: liveHolds.find((h) => h.candidateId === c.id)?.id ?? null,
      });
    }
    candidates.sort(compareOutreachPriority);
    for (const c of candidates) {
      const eligible = candidates.filter(
        (x) =>
          x.openingId === c.openingId &&
          !x.releasedAt &&
          x.outreach.state !== "closed",
      );
      const active = eligible.filter(hasActivePursuit);
      const first = active[0] ?? eligible[0];
      if (first && first.id !== c.id && !c.releasedAt) {
        c.waitingForCandidateId = first.id;
        c.waitingFor = {
          candidateId: first.id,
          organizationName: first.organizationName,
          openingId: first.openingId,
          openingTitle: openings.find((o) => o.id === first.openingId)!.title,
          reason: `${first.organizationName} is the current pursuit for this opening.`,
        };
      }
    }
    return {
      enabled: true,
      openings,
      candidates,
      researchTasks: json(await this.db.select().from(outreachResearchTasks)),
      legs: await this.db
        .select({
          id: travelLegs.id,
          name: travelLegs.name,
          active: sql<boolean>`${travelLegs.archivedAt} is null`,
        })
        .from(travelLegs),
      packages: await this.db
        .select({
          id: packageTemplates.id,
          code: packageTemplates.code,
          name: packageTemplates.name,
          active: packageTemplates.active,
          normalCapacity: packageTemplates.normalCapacity,
          temporaryUnavailableQuantity:
            packageTemplates.temporaryUnavailableQuantity,
        })
        .from(packageTemplates),
    };
  }
  async opening(input: OpeningInput) {
    if (
      !input.legId ||
      !rowsOf(
        await this.db.execute(
          sql`select id from travel_legs where id=${input.legId}::uuid and archived_at is null`,
        ),
      ).length
    )
      throw new OutreachError(400, "Select a configured active travel leg.");
    const packages = rowsOf<{ code: string }>(
      await this.db.execute(
        sql`select code from package_templates where active=true`,
      ),
    );
    if (
      Object.keys(input.quantities).some(
        (code) => !packages.some((p) => p.code === code),
      )
    )
      throw new OutreachError(400, "Select only configured active packages.");
    const [row] = await this.db
      .insert(outreachOpenings)
      .values(input)
      .returning();
    return row;
  }
  async candidate(input: CandidateInput) {
    const [opening] = await this.db
      .select()
      .from(outreachOpenings)
      .where(eq(outreachOpenings.id, input.openingId));
    const [op] = await this.db
      .select()
      .from(bookingOpportunities)
      .where(eq(bookingOpportunities.id, input.opportunityId));
    if (!opening || !op)
      throw new OutreachError(404, "Opening or opportunity not found.");
    if (opening.status !== "open")
      throw new OutreachError(409, "Opening is filled or closed.");
    if (opening.eventYear !== op.eventYear)
      throw new OutreachError(
        400,
        "Opportunity event year must match the opening.",
      );
    const [profile] = rowsOf<{
      last_resort: boolean;
      consolidated: string | null;
    }>(
      await this.db.execute(
        sql`select last_resort,to_jsonb(g)->>'consolidated_into_id' as consolidated from organizations g where id=${op.organizationId}::uuid`,
      ),
    );
    if (!profile || profile.consolidated)
      throw new OutreachError(
        409,
        "Select an active profile; this profile is missing or consolidated.",
      );
    const protectedReason = await outreachContactBlock(this.db, {
      organizationId: op.organizationId,
      contactId: op.contactId,
    });
    if (
      profile.last_resort ||
      op.emailAutomationProtected ||
      (op.status === "territory_hold" && !op.territoryExceptionApproved) ||
      protectedReason
    )
      throw new OutreachError(
        409,
        protectedReason ??
          "Protected contact or territory hold requires owner review.",
      );
    const [row] = await this.db
      .insert(outreachCandidates)
      .values(input)
      .returning();
    return row;
  }
  async patch(id: string, input: CandidatePatch) {
    const { reason, ...fields } = input;
    const [row] = await this.db
      .update(outreachCandidates)
      .set({
        ...fields,
        snoozedUntil:
          fields.snoozedUntil === undefined
            ? undefined
            : fields.snoozedUntil === null
              ? null
              : new Date(fields.snoozedUntil),
        decisionDueAt:
          fields.decisionDueAt === undefined
            ? undefined
            : fields.decisionDueAt === null
              ? null
              : new Date(fields.decisionDueAt),
        meaningfulReplyAt:
          fields.meaningfulReplyAt === undefined
            ? undefined
            : fields.meaningfulReplyAt === null
              ? null
              : new Date(fields.meaningfulReplyAt),
      })
      .where(eq(outreachCandidates.id, id))
      .returning();
    if (!row) throw new OutreachError(404, "Candidate not found.");
    return { ...row, reason };
  }
  async attempt(
    id: string,
    input: AttemptInput,
    occurredAt: string,
    actor: string,
  ) {
    const [row] = await this.db
      .insert(outreachAttempts)
      .values({
        candidateId: id,
        ...input,
        occurredAt: new Date(occurredAt),
        actor,
      })
      .returning();
    return row;
  }
  async release(id: string, now: Date) {
    const [row] = await this.db
      .update(outreachCandidates)
      .set({ releasedAt: now })
      .where(eq(outreachCandidates.id, id))
      .returning();
    return row;
  }
  async check(id: string, sources: CandidateDTO["sources"]) {
    const [row] = await this.db
      .update(outreachCandidates)
      .set({
        checkedAt: new Date(sources.checkedAt),
        sourceSnapshot: json(sources),
      })
      .where(eq(outreachCandidates.id, id))
      .returning();
    return row;
  }
  async research(openingId: string, input: ResearchInput, now: Date) {
    const [opening] = await this.db
      .select()
      .from(outreachOpenings)
      .where(eq(outreachOpenings.id, openingId));
    if (!opening) throw new OutreachError(404, "Opening not found.");
    if (opening.status !== "open")
      throw new OutreachError(
        409,
        "Opening is filled or closed; research is paused.",
      );
    const [row] = await this.db
      .insert(outreachResearchTasks)
      .values({ openingId, ...input })
      .onConflictDoUpdate({
        target: [
          outreachResearchTasks.openingId,
          outreachResearchTasks.criteria,
        ],
        set: {
          qualificationCriteria: input.qualificationCriteria,
          targetCount: input.targetCount,
          status: "pending",
        },
      })
      .returning();
    const results = (row.results ?? []).map((result) => ({
      ...result,
      qualified: qualifiesResearchResult(
        result,
        row.qualificationCriteria,
        now,
      ),
    }));
    const qualifiedCount = new Set(
      results.filter((r) => r.qualified).map((r) => r.opportunityId),
    ).size;
    const [updated] = await this.db
      .update(outreachResearchTasks)
      .set({
        results,
        status: qualifiedCount >= row.targetCount ? "completed" : "pending",
      })
      .where(eq(outreachResearchTasks.id, row.id))
      .returning();
    return updated;
  }
  async reviewHistory(
    id: string,
    reason: string,
    fingerprint: string,
    now: Date,
  ) {
    const [row] = await this.db
      .update(outreachCandidates)
      .set({
        historyReview: {
          reviewedThrough: now.toISOString(),
          reason,
          fingerprint,
        },
      })
      .where(eq(outreachCandidates.id, id))
      .returning();
    return row;
  }
  async openingStatus(id: string, status: "open" | "filled" | "closed") {
    const [row] = await this.db
      .update(outreachOpenings)
      .set({ status })
      .where(eq(outreachOpenings.id, id))
      .returning();
    if (!row) throw new OutreachError(404, "Opening not found.");
    await this.db
      .update(outreachResearchTasks)
      .set({ status: status === "open" ? "pending" : "paused" })
      .where(
        and(
          eq(outreachResearchTasks.openingId, id),
          sql`${outreachResearchTasks.status} <> 'completed'`,
        ),
      );
    return row;
  }
  async opportunities(
    search: string,
    year: number,
  ): Promise<OpportunityChoiceDTO[]> {
    const rows = await this.db
      .select({
        id: bookingOpportunities.id,
        organizationId: bookingOpportunities.organizationId,
        bookingId: bookingOpportunities.bookingId,
        organizationName: organizations.name,
        eventYear: bookingOpportunities.eventYear,
        status: bookingOpportunities.status,
      })
      .from(bookingOpportunities)
      .innerJoin(
        organizations,
        eq(organizations.id, bookingOpportunities.organizationId),
      )
      .where(
        and(
          eq(bookingOpportunities.eventYear, year),
          ilike(organizations.name, `%${search}%`),
          sql`to_jsonb(${organizations})->>'consolidated_into_id' is null`,
        ),
      )
      .limit(50);
    return Promise.all(
      rows.map(async (row) => ({
        ...row,
        suggestions: await classificationSuggestions(this.db, row.organizationId),
        bookings: rowsOf<OpportunityChoiceDTO["bookings"][number]>(
          await this.db.execute(
            sql`select id,name,starts_at as "startsAt",ends_at as "endsAt" from bookings where organization_id=${row.organizationId}::uuid and (starts_at is null or extract(year from starts_at at time zone 'America/Chicago')=${year}) order by starts_at nulls last,id`,
          ),
        ),
      })),
    );
  }
  async researchResults(id: string, results: ResearchResultInput[], now: Date) {
    const [task] = await this.db
      .select()
      .from(outreachResearchTasks)
      .where(eq(outreachResearchTasks.id, id));
    if (!task) throw new OutreachError(404, "Research task not found.");
    const [opening] = await this.db
      .select()
      .from(outreachOpenings)
      .where(eq(outreachOpenings.id, task.openingId));
    if (opening.status !== "open")
      throw new OutreachError(
        409,
        "Opening is filled or closed; research is paused.",
      );
    for (const result of results) {
      const [op] = await this.db
        .select()
        .from(bookingOpportunities)
        .where(eq(bookingOpportunities.id, result.opportunityId));
      if (!op) throw new OutreachError(404, "Research opportunity not found.");
      if (op.eventYear !== opening.eventYear)
        throw new OutreachError(
          400,
          "Research result must match opening event year.",
        );
    }
    const merged = new Map(
      (task.results ?? []).map((r) => [`${r.opportunityId}|${r.sourceUrl}`, r]),
    );
    for (const result of results) {
      if (new Date(result.checkedAt) > now)
        throw new OutreachError(
          400,
          "Research checked date cannot be in the future.",
        );

      merged.set(`${result.opportunityId}|${result.sourceUrl}`, { ...result });
    }
    const values = [...merged.values()].map((result) => ({
      ...result,
      qualified: qualifiesResearchResult(
        result,
        task.qualificationCriteria,
        now,
      ),
    }));
    const qualifiedCount = new Set(
      values.filter((r) => r.qualified).map((r) => r.opportunityId),
    ).size;
    const [row] = await this.db
      .update(outreachResearchTasks)
      .set({
        results: values,
        status: qualifiedCount >= task.targetCount ? "completed" : "pending",
      })
      .where(eq(outreachResearchTasks.id, id))
      .returning();
    return row;
  }
}
