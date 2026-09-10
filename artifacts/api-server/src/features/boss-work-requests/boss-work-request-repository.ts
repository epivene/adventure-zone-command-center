import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import {
  bossConventionDrafts,
  bossConventionSubmissions,
  bossWorkRequestEvents,
  bossWorkRequests,
  communicationTemplateReviews,
  communicationTemplates,
} from "@/db/schema";
import type {
  BossWorkRequestActorKind,
  BossWorkRequestPriority,
  BossWorkRequestState,
  BossWorkRequestType,
  ConventionNotesPayload,
} from "@workspace/db/boss-work-request-schema";
import { assertTransition } from "./boss-work-request-state";

type Database = NodePgDatabase<typeof schema>;

export class BossWorkRequestNotFoundError extends Error {}
export class BossWorkRequestConflictError extends Error {}

export class BossWorkRequestRepository {
  constructor(private readonly database: Database) {}

  async listForBoss(bossAccountId: string) {
    return this.database.select().from(bossWorkRequests)
      .where(eq(bossWorkRequests.assignedBossAccountId, bossAccountId))
      .orderBy(asc(bossWorkRequests.completedAt), asc(bossWorkRequests.dueAt), desc(bossWorkRequests.createdAt));
  }

  async listForOwner(states?: BossWorkRequestState[]) {
    const query = this.database.select().from(bossWorkRequests);
    return states?.length
      ? query.where(inArray(bossWorkRequests.state, states)).orderBy(desc(bossWorkRequests.updatedAt))
      : query.orderBy(desc(bossWorkRequests.updatedAt));
  }

  async getForBoss(id: string, bossAccountId: string) {
    const request = (await this.database.select().from(bossWorkRequests)
      .where(and(eq(bossWorkRequests.id, id), eq(bossWorkRequests.assignedBossAccountId, bossAccountId))).limit(1))[0];
    if (!request) return null;
    const [draft, submissions, review, events] = await Promise.all([
      this.database.select().from(bossConventionDrafts)
        .where(and(eq(bossConventionDrafts.requestId, id), eq(bossConventionDrafts.bossAccountId, bossAccountId))).limit(1),
      this.database.select().from(bossConventionSubmissions)
        .where(eq(bossConventionSubmissions.requestId, id)).orderBy(desc(bossConventionSubmissions.createdAt)),
      this.database.select().from(communicationTemplateReviews)
        .where(eq(communicationTemplateReviews.requestId, id))
        .orderBy(asc(communicationTemplateReviews.position)),
      this.database.select().from(bossWorkRequestEvents)
        .where(eq(bossWorkRequestEvents.requestId, id)).orderBy(asc(bossWorkRequestEvents.createdAt)),
    ]);
    return {
      request,
      draft: draft[0] ?? null,
      submissions,
      templateReviews: review,
      templateReview: review.length === 1 ? review[0] : null,
      events,
    };
  }

  async getForOwner(id: string) {
    const request = (await this.database.select().from(bossWorkRequests)
      .where(eq(bossWorkRequests.id, id)).limit(1))[0];
    if (!request) return null;
    const [submissions, review, events] = await Promise.all([
      this.database.select().from(bossConventionSubmissions)
        .where(eq(bossConventionSubmissions.requestId, id)).orderBy(desc(bossConventionSubmissions.createdAt)),
      this.database.select().from(communicationTemplateReviews)
        .where(eq(communicationTemplateReviews.requestId, id))
        .orderBy(asc(communicationTemplateReviews.position)),
      this.database.select().from(bossWorkRequestEvents)
        .where(eq(bossWorkRequestEvents.requestId, id)).orderBy(asc(bossWorkRequestEvents.createdAt)),
    ]);
    return {
      request,
      submissions,
      templateReviews: review,
      templateReview: review.length === 1 ? review[0] : null,
      events,
    };
  }

  async create(input: {
    type: BossWorkRequestType;
    state?: BossWorkRequestState;
    priority: BossWorkRequestPriority;
    title: string;
    instructions?: string | null;
    dueAt?: Date | null;
    createdByOwnerId: string;
    assignedBossAccountId: string;
    deduplicationKey?: string | null;
  }) {
    return this.database.transaction(async (tx) => {
      const inserted = await tx.insert(bossWorkRequests).values({
        ...input,
        state: input.state ?? "waiting_on_dave",
      }).onConflictDoNothing().returning();
      const request = inserted[0] ?? (input.deduplicationKey
        ? (await tx.select().from(bossWorkRequests).where(and(
            eq(bossWorkRequests.assignedBossAccountId, input.assignedBossAccountId),
            eq(bossWorkRequests.deduplicationKey, input.deduplicationKey),
          )).limit(1))[0]
        : null);
      if (!request) throw new BossWorkRequestConflictError("The work request could not be created.");
      if (inserted.length) {
        await tx.insert(bossWorkRequestEvents).values({
          requestId: request.id,
          actorKind: "owner",
          actorId: input.createdByOwnerId,
          priorState: null,
          newState: request.state,
          note: input.instructions ?? null,
        });
      }
      return { request, created: inserted.length > 0 };
    });
  }

  async createTemplateReviewSet(input: {
    request: {
      priority: BossWorkRequestPriority;
      title: string;
      instructions?: string | null;
      dueAt?: Date | null;
      createdByOwnerId: string;
      assignedBossAccountId: string;
      deduplicationKey: string;
    };
    reviews: Array<{
      templateId: string;
      position: number;
      templateNameSnapshot: string;
      templateVersion: string | null;
      contentFingerprint: string;
      subjectSnapshot: string | null;
      bodySnapshot: string;
      bodyFormatSnapshot: "plain_text" | "html";
    }>;
  }) {
    return this.database.transaction(async (tx) => {
      const inserted = await tx.insert(bossWorkRequests).values({
        ...input.request,
        type: "email_template_approval",
        state: "waiting_on_dave",
      }).onConflictDoNothing().returning();
      const request = inserted[0] ?? (await tx.select().from(bossWorkRequests).where(and(
        eq(bossWorkRequests.assignedBossAccountId, input.request.assignedBossAccountId),
        eq(bossWorkRequests.deduplicationKey, input.request.deduplicationKey),
      )).limit(1))[0];
      if (!request) throw new BossWorkRequestConflictError("The review set could not be created.");

      if (inserted.length) {
        await tx.insert(bossWorkRequestEvents).values({
          requestId: request.id,
          actorKind: "owner",
          actorId: input.request.createdByOwnerId,
          priorState: null,
          newState: "waiting_on_dave",
          note: input.request.instructions ?? null,
          metadata: { reviewCount: input.reviews.length },
        });
        await tx.insert(communicationTemplateReviews).values(input.reviews.map((review) => ({
          ...review,
          requestId: request.id,
          verifiedLinks: [],
        })));
      }
      return { request, created: inserted.length > 0 };
    });
  }

  async createTemplateReview(input: {
    requestId: string;
    templateId: string;
    position: number;
    templateNameSnapshot: string;
    contentFingerprint: string;
    subjectSnapshot: string | null;
    bodySnapshot: string;
    bodyFormatSnapshot: "plain_text" | "html";
    templateVersion: string | null;
    verifiedLinks?: Array<{ href: string; label: string; verifiedAt: string }>;
  }) {
    return (await this.database.insert(communicationTemplateReviews).values({
      ...input,
      verifiedLinks: input.verifiedLinks ?? [],
    })
      .onConflictDoNothing({
        target: [communicationTemplateReviews.requestId, communicationTemplateReviews.templateId],
      })
      .returning())[0] ?? (await this.database.select().from(communicationTemplateReviews)
        .where(and(
          eq(communicationTemplateReviews.requestId, input.requestId),
          eq(communicationTemplateReviews.templateId, input.templateId),
        )).limit(1))[0]!;
  }

  async saveDraft(input: {
    requestId: string;
    bossAccountId: string;
    clientRevision: number;
    payload: ConventionNotesPayload;
  }) {
    const request = await this.getAssignedRequest(input.requestId, input.bossAccountId);
    if (!["rapid_convention_notes", "convention_planning_questionnaire"].includes(request.type) || ["applied", "cancelled"].includes(request.state)) {
      throw new BossWorkRequestConflictError("This convention form is no longer editable.");
    }
    const saved = await this.database.insert(bossConventionDrafts).values(input)
      .onConflictDoUpdate({
        target: [bossConventionDrafts.requestId, bossConventionDrafts.bossAccountId],
        set: {
          clientRevision: sql`excluded.client_revision`,
          payload: sql`excluded.payload`,
          updatedAt: new Date(),
        },
        setWhere: sql`excluded.client_revision > ${bossConventionDrafts.clientRevision}`,
      }).returning();
    const current = saved[0] ?? (await this.database.select().from(bossConventionDrafts).where(and(
      eq(bossConventionDrafts.requestId, input.requestId),
      eq(bossConventionDrafts.bossAccountId, input.bossAccountId),
    )).limit(1))[0]!;
    if (request.state === "waiting_on_dave") {
      await this.transition(input.requestId, "in_progress", "boss", input.bossAccountId);
    }
    return { accepted: saved.length > 0, draft: current };
  }

  async submitConvention(input: {
    requestId: string;
    bossAccountId: string;
    clientMutationId: string;
    payload: ConventionNotesPayload;
  }) {
    const request = await this.getAssignedRequest(input.requestId, input.bossAccountId);
    if (!["rapid_convention_notes", "convention_planning_questionnaire"].includes(request.type) || ["applied", "cancelled"].includes(request.state)) {
      throw new BossWorkRequestConflictError("This convention request is closed.");
    }
    return this.database.transaction(async (tx) => {
      const inserted = await tx.insert(bossConventionSubmissions).values(input)
        .onConflictDoNothing({
          target: [bossConventionSubmissions.requestId, bossConventionSubmissions.clientMutationId],
        }).returning();
      const submission = inserted[0] ?? (await tx.select().from(bossConventionSubmissions).where(and(
        eq(bossConventionSubmissions.requestId, input.requestId),
        eq(bossConventionSubmissions.clientMutationId, input.clientMutationId),
      )).limit(1))[0]!;
      if (inserted.length && request.state !== "submitted_to_owner") {
        assertTransition(request.state, "submitted_to_owner");
        const changed = await tx.update(bossWorkRequests).set({
          state: "submitted_to_owner", updatedAt: new Date(),
        }).where(and(eq(bossWorkRequests.id, input.requestId), eq(bossWorkRequests.state, request.state))).returning();
        if (!changed.length) throw new BossWorkRequestConflictError("The request changed while saving.");
        await tx.insert(bossWorkRequestEvents).values({
          requestId: input.requestId, actorKind: "boss", actorId: input.bossAccountId,
          priorState: request.state, newState: "submitted_to_owner", note: "Convention notes submitted.",
        });
      }
      return { submission, created: inserted.length > 0 };
    });
  }

  async updateConventionSubmission(input: {
    requestId: string;
    submissionId: string;
    bossAccountId: string;
    payload: ConventionNotesPayload;
  }) {
    await this.getAssignedRequest(input.requestId, input.bossAccountId);
    const updated = (await this.database.update(bossConventionSubmissions).set({
      payload: input.payload,
      editVersion: sql`${bossConventionSubmissions.editVersion} + 1`,
      updatedAt: new Date(),
    }).where(and(
      eq(bossConventionSubmissions.id, input.submissionId),
      eq(bossConventionSubmissions.requestId, input.requestId),
      eq(bossConventionSubmissions.bossAccountId, input.bossAccountId),
      sql`${bossConventionSubmissions.appliedAt} is null`,
    )).returning())[0];
    if (!updated) throw new BossWorkRequestConflictError("Applied notes cannot be edited.");
    return updated;
  }

  async transition(
    requestId: string,
    nextState: BossWorkRequestState,
    actorKind: BossWorkRequestActorKind,
    actorId: string | null,
    note?: string | null,
  ) {
    return this.database.transaction(async (tx) => {
      const current = (await tx.select().from(bossWorkRequests).where(eq(bossWorkRequests.id, requestId)).limit(1))[0];
      if (!current) throw new BossWorkRequestNotFoundError("Work request not found.");
      if (current.state === nextState) return current;
      assertTransition(current.state, nextState);
      const updated = (await tx.update(bossWorkRequests).set({
        state: nextState,
        completedAt: ["approved", "applied", "cancelled"].includes(nextState) ? new Date() : null,
        updatedAt: new Date(),
      }).where(and(eq(bossWorkRequests.id, requestId), eq(bossWorkRequests.state, current.state))).returning())[0];
      if (!updated) throw new BossWorkRequestConflictError("The request changed. Refresh and try again.");
      await tx.insert(bossWorkRequestEvents).values({
        requestId, actorKind, actorId, priorState: current.state, newState: nextState, note: note ?? null,
      });
      return updated;
    });
  }

  async decideTemplateReview(input: {
    requestId: string;
    reviewId: string;
    bossAccountId: string;
    decision: "approved" | "changes_requested";
    note?: string | null;
    expectedFingerprint: string;
    verifiedLinks: Array<{ href: string; label: string; verifiedAt: string }>;
  }) {
    const detail = await this.getForBoss(input.requestId, input.bossAccountId);
    const selected = detail?.templateReviews.find((review) => review.id === input.reviewId);
    if (!detail || !selected) throw new BossWorkRequestNotFoundError("Template review not found.");
    if (selected.contentFingerprint !== input.expectedFingerprint) {
      throw new BossWorkRequestConflictError("The template changed. Review the newest version.");
    }
    if (selected.decision !== "pending") {
      return { request: detail.request, review: selected, repeated: true };
    }

    return this.database.transaction(async (tx) => {
      const review = (await tx.update(communicationTemplateReviews).set({
        decision: input.decision,
        note: input.note ?? null,
        verifiedLinks: input.verifiedLinks,
        decidedByBossAccountId: input.bossAccountId,
        decidedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(
        eq(communicationTemplateReviews.id, selected.id),
        eq(communicationTemplateReviews.requestId, input.requestId),
        eq(communicationTemplateReviews.decision, "pending"),
        eq(communicationTemplateReviews.contentFingerprint, input.expectedFingerprint),
      )).returning())[0];
      if (!review) throw new BossWorkRequestConflictError("This review has already been decided.");

      if (input.decision === "approved") {
        const activated = await tx.update(communicationTemplates).set({
          state: "active",
          reviewedBy: detail.request.assignedBossAccountId,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        }).where(and(
          eq(communicationTemplates.id, review.templateId),
          eq(communicationTemplates.bodyTemplate, review.bodySnapshot),
          review.subjectSnapshot === null
            ? sql`${communicationTemplates.subjectTemplate} is null`
            : eq(communicationTemplates.subjectTemplate, review.subjectSnapshot),
          eq(communicationTemplates.bodyFormat, review.bodyFormatSnapshot),
        )).returning({ id: communicationTemplates.id });
        if (!activated.length) {
          throw new BossWorkRequestConflictError("The template changed. Review the newest version.");
        }
      }

      const reviews = await tx.select().from(communicationTemplateReviews)
        .where(eq(communicationTemplateReviews.requestId, input.requestId))
        .orderBy(asc(communicationTemplateReviews.position));
      const hasPending = reviews.some((item) => item.decision === "pending");
      const hasChanges = reviews.some((item) => item.decision === "changes_requested");
      const nextState: BossWorkRequestState = hasPending
        ? "in_progress"
        : hasChanges ? "changes_requested" : "approved";
      if (detail.request.state !== nextState) assertTransition(detail.request.state, nextState);
      const request = (await tx.update(bossWorkRequests).set({
        state: nextState,
        completedAt: nextState === "approved" ? new Date() : null,
        updatedAt: new Date(),
      }).where(and(
        eq(bossWorkRequests.id, input.requestId),
        eq(bossWorkRequests.state, detail.request.state),
      )).returning())[0];
      if (!request) throw new BossWorkRequestConflictError("The request changed. Refresh and try again.");

      await tx.insert(bossWorkRequestEvents).values({
        requestId: input.requestId,
        actorKind: "boss",
        actorId: input.bossAccountId,
        priorState: detail.request.state,
        newState: nextState,
        note: input.note ?? null,
        metadata: {
          reviewId: review.id,
          templateId: review.templateId,
          decision: input.decision,
        },
      });
      return { request, review, repeated: false };
    });
  }

  private async getAssignedRequest(requestId: string, bossAccountId: string) {
    const request = (await this.database.select().from(bossWorkRequests).where(and(
      eq(bossWorkRequests.id, requestId),
      eq(bossWorkRequests.assignedBossAccountId, bossAccountId),
    )).limit(1))[0];
    if (!request) throw new BossWorkRequestNotFoundError("Work request not found.");
    return request;
  }
}
