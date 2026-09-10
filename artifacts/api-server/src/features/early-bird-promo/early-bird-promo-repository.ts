import {
  and,
  desc,
  eq,
  gt,
  isNull,
  lte,
  or,
} from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import {
  commercialOfferRules,
  contacts,
  earlyBirdPromoEnrollments,
  followUps,
  officeAccounts,
  officeEmailDrafts,
} from "@/db/schema";
import { formatEarlyBirdPromoDeadline } from "./early-bird-promo-policy";

type Database = NodePgDatabase<typeof schema>;
export type EarlyBirdPromoRecord =
  typeof earlyBirdPromoEnrollments.$inferSelect;

export type CreateEarlyBirdPromoInput = Omit<
  typeof earlyBirdPromoEnrollments.$inferInsert,
  "id" | "createdAt" | "updatedAt" | "status"
>;

export class EarlyBirdPromoRepository {
  constructor(private readonly database: Database) {}

  async getOfferByCode(code: string) {
    return (await this.database
      .select()
      .from(commercialOfferRules)
      .where(eq(commercialOfferRules.code, code))
      .limit(1))[0] ?? null;
  }

  async getForProfileYear(
    organizationId: string,
    eventYear: number,
  ): Promise<EarlyBirdPromoRecord | null> {
    return (await this.database
      .select()
      .from(earlyBirdPromoEnrollments)
      .where(and(
        eq(earlyBirdPromoEnrollments.organizationId, organizationId),
        eq(earlyBirdPromoEnrollments.eventYear, eventYear),
      ))
      .orderBy(desc(earlyBirdPromoEnrollments.createdAt))
      .limit(1))[0] ?? null;
  }

  async getForOpportunity(
    opportunityId: string,
  ): Promise<EarlyBirdPromoRecord | null> {
    return (await this.database
      .select()
      .from(earlyBirdPromoEnrollments)
      .where(eq(earlyBirdPromoEnrollments.opportunityId, opportunityId))
      .orderBy(desc(earlyBirdPromoEnrollments.createdAt))
      .limit(1))[0] ?? null;
  }

  async getById(enrollmentId: string): Promise<EarlyBirdPromoRecord | null> {
    return (await this.database
      .select()
      .from(earlyBirdPromoEnrollments)
      .where(eq(earlyBirdPromoEnrollments.id, enrollmentId))
      .limit(1))[0] ?? null;
  }

  async createFromConfirmedSend(
    input: CreateEarlyBirdPromoInput,
  ): Promise<EarlyBirdPromoRecord> {
    const inserted = await this.database
      .insert(earlyBirdPromoEnrollments)
      .values(input)
      .onConflictDoNothing({
        target: [
          earlyBirdPromoEnrollments.commercialOfferRuleId,
          earlyBirdPromoEnrollments.organizationId,
          earlyBirdPromoEnrollments.eventYear,
        ],
      })
      .returning();
    if (inserted[0]) return inserted[0];
    const existing = await this.getForProfileYear(
      input.organizationId,
      input.eventYear,
    );
    if (!existing) throw new Error("EARLY_BIRD_PROMO_CREATE_FAILED");
    return existing;
  }

  async confirmInterest(input: {
    enrollmentId: string;
    confirmedAt: Date;
    evidenceMessageId: string | null;
    reminderDueAt: Date;
  }): Promise<EarlyBirdPromoRecord | null> {
    return (await this.database
      .update(earlyBirdPromoEnrollments)
      .set({
        interestConfirmedAt: input.confirmedAt,
        interestEvidenceMessageId: input.evidenceMessageId,
        reminderDueAt: input.reminderDueAt,
        updatedAt: input.confirmedAt,
      })
      .where(and(
        eq(earlyBirdPromoEnrollments.id, input.enrollmentId),
        eq(earlyBirdPromoEnrollments.status, "active"),
        isNull(earlyBirdPromoEnrollments.depositReceivedAt),
        or(
          isNull(earlyBirdPromoEnrollments.interestConfirmedAt),
          eq(earlyBirdPromoEnrollments.interestEvidenceMessageId, input.evidenceMessageId ?? ""),
        ),
      ))
      .returning())[0] ?? null;
  }

  async secureWithDeposit(input: {
    organizationId: string;
    eventYear: number;
    receivedAt: Date;
    source: string;
  }): Promise<EarlyBirdPromoRecord | null> {
    return this.database.transaction(async (transaction) => {
      const current = (await transaction.select().from(earlyBirdPromoEnrollments)
        .where(and(
          eq(earlyBirdPromoEnrollments.organizationId, input.organizationId),
          eq(earlyBirdPromoEnrollments.eventYear, input.eventYear),
        ))
        .orderBy(desc(earlyBirdPromoEnrollments.createdAt))
        .limit(1)
        .for("update"))[0];
      if (!current) return null;
      if (current.status !== "active") return current;
      const updated = (await transaction.update(earlyBirdPromoEnrollments)
        .set({
          status: "secured",
          depositReceivedAt: input.receivedAt,
          depositSource: input.source,
          claimLeaseOwner: null,
          claimLeaseExpiresAt: null,
          updatedAt: input.receivedAt,
        })
        .where(eq(earlyBirdPromoEnrollments.id, current.id))
        .returning())[0];
      if (current.reminderFollowUpId) {
        await transaction.update(followUps).set({
          completedAt: input.receivedAt,
          outcome: "Deposit received; Early Bird Promo secured.",
        }).where(and(
          eq(followUps.id, current.reminderFollowUpId),
          isNull(followUps.completedAt),
        ));
      }
      if (current.reminderDraftId) {
        await transaction.update(officeEmailDrafts).set({
          state: "cancelled",
          ownerReturnNote: "Deposit received; reminder no longer needed.",
          updatedAt: input.receivedAt,
        }).where(and(
          eq(officeEmailDrafts.id, current.reminderDraftId),
          or(
            eq(officeEmailDrafts.state, "draft"),
            eq(officeEmailDrafts.state, "submitted"),
            eq(officeEmailDrafts.state, "needs_changes"),
          ),
        ));
      }
      return updated ?? null;
    });
  }

  async cancel(input: {
    enrollmentId: string;
    reason: string;
    cancelledAt: Date;
  }): Promise<EarlyBirdPromoRecord | null> {
    return (await this.database
      .update(earlyBirdPromoEnrollments)
      .set({
        status: "cancelled",
        cancelReason: input.reason,
        claimLeaseOwner: null,
        claimLeaseExpiresAt: null,
        updatedAt: input.cancelledAt,
      })
      .where(eq(earlyBirdPromoEnrollments.id, input.enrollmentId))
      .returning())[0] ?? null;
  }

  async expireDue(now: Date): Promise<number> {
    const rows = await this.database
      .update(earlyBirdPromoEnrollments)
      .set({
        status: "expired",
        claimLeaseOwner: null,
        claimLeaseExpiresAt: null,
        updatedAt: now,
      })
      .where(and(
        eq(earlyBirdPromoEnrollments.status, "active"),
        isNull(earlyBirdPromoEnrollments.depositReceivedAt),
        lte(earlyBirdPromoEnrollments.expiresAt, now),
      ))
      .returning({ id: earlyBirdPromoEnrollments.id });
    return rows.length;
  }

  async claimOneReminder(input: {
    workerId: string;
    now: Date;
  }): Promise<EarlyBirdPromoRecord | null> {
    return this.database.transaction(async (transaction) => {
      const candidate = (await transaction
        .select({ id: earlyBirdPromoEnrollments.id })
        .from(earlyBirdPromoEnrollments)
        .where(and(
          eq(earlyBirdPromoEnrollments.status, "active"),
          isNull(earlyBirdPromoEnrollments.depositReceivedAt),
          isNull(earlyBirdPromoEnrollments.reminderDraftId),
          lte(earlyBirdPromoEnrollments.reminderDueAt, input.now),
          gt(earlyBirdPromoEnrollments.expiresAt, input.now),
          or(
            isNull(earlyBirdPromoEnrollments.claimLeaseExpiresAt),
            lte(earlyBirdPromoEnrollments.claimLeaseExpiresAt, input.now),
          ),
        ))
        .orderBy(earlyBirdPromoEnrollments.reminderDueAt)
        .limit(1)
        .for("update", { skipLocked: true }))[0];
      if (!candidate) return null;
      return (await transaction
        .update(earlyBirdPromoEnrollments)
        .set({
          claimLeaseOwner: input.workerId,
          claimLeaseExpiresAt: new Date(input.now.getTime() + 60_000),
          updatedAt: input.now,
        })
        .where(eq(earlyBirdPromoEnrollments.id, candidate.id))
        .returning())[0] ?? null;
    });
  }

  async releaseReminderClaim(input: {
    enrollmentId: string;
    workerId: string;
    now: Date;
  }): Promise<void> {
    await this.database
      .update(earlyBirdPromoEnrollments)
      .set({ claimLeaseOwner: null, claimLeaseExpiresAt: null, updatedAt: input.now })
      .where(and(
        eq(earlyBirdPromoEnrollments.id, input.enrollmentId),
        eq(earlyBirdPromoEnrollments.claimLeaseOwner, input.workerId),
      ));
  }

  async createReminderArtifacts(input: {
    enrollmentId: string;
    workerId: string;
    now: Date;
  }): Promise<{ draftId: string; followUpId: string }> {
    return this.database.transaction(async (transaction) => {
      const enrollment = (await transaction
        .select()
        .from(earlyBirdPromoEnrollments)
        .where(and(
          eq(earlyBirdPromoEnrollments.id, input.enrollmentId),
          eq(earlyBirdPromoEnrollments.status, "active"),
          eq(earlyBirdPromoEnrollments.claimLeaseOwner, input.workerId),
          isNull(earlyBirdPromoEnrollments.reminderDraftId),
          isNull(earlyBirdPromoEnrollments.reminderFollowUpId),
        ))
        .limit(1)
        .for("update"))[0];
      if (!enrollment?.contactId || !enrollment.reminderDueAt) {
        throw new Error("EARLY_BIRD_PROMO_REMINDER_CONTEXT_MISSING");
      }
      const contact = (await transaction
        .select({
          firstName: contacts.firstName,
          lastName: contacts.lastName,
          email: contacts.email,
        })
        .from(contacts)
        .where(eq(contacts.id, enrollment.contactId))
        .limit(1))[0];
      const recipientEmail = contact?.email?.trim().toLowerCase();
      if (!contact || !recipientEmail) {
        throw new Error("EARLY_BIRD_PROMO_REMINDER_RECIPIENT_MISSING");
      }
      const account = enrollment.officeAccountId
        ? (await transaction
            .select({ displayName: officeAccounts.displayName })
            .from(officeAccounts)
            .where(eq(officeAccounts.id, enrollment.officeAccountId))
            .limit(1))[0]
        : null;
      const contactName = [contact.firstName, contact.lastName]
        .map((value) => value.trim())
        .filter(Boolean)
        .join(" ") || "there";
      const senderName = account?.displayName?.trim() || "The Adventure Zone Team";
      const deadline = formatEarlyBirdPromoDeadline(enrollment.deadlineDate);
      const body = `Hi ${contactName},\n\nJust a reminder—our Early Bird Promo ends ${deadline}. Submit your deposit by then to receive 10% off and secure your event date.\n\nThanks,\n${senderName}\nThe Adventure Zone`;

      const followUp = (await transaction.insert(followUps).values({
        organizationId: enrollment.organizationId,
        contactId: enrollment.contactId,
        bookingId: null,
        kind: "early_bird_promo",
        dueAt: enrollment.reminderDueAt,
      }).returning({ id: followUps.id }))[0];
      const draft = (await transaction.insert(officeEmailDrafts).values({
        officeAccountId: enrollment.officeAccountId,
        organizationId: enrollment.organizationId,
        contactId: enrollment.contactId,
        bookingId: enrollment.bookingId,
        eventYear: enrollment.eventYear,
        communicationTemplateId: null,
        recipientEmail,
        subject: "Early Bird Promo reminder",
        body,
        coordinatorNote: "Prepared automatically for owner review; never auto-send.",
        state: "submitted",
        submittedAt: input.now,
      }).returning({ id: officeEmailDrafts.id }))[0];
      if (!followUp || !draft) throw new Error("EARLY_BIRD_PROMO_REMINDER_CREATE_FAILED");

      const attached = (await transaction.update(earlyBirdPromoEnrollments).set({
        reminderDraftId: draft.id,
        reminderFollowUpId: followUp.id,
        claimLeaseOwner: null,
        claimLeaseExpiresAt: null,
        updatedAt: input.now,
      }).where(and(
        eq(earlyBirdPromoEnrollments.id, enrollment.id),
        eq(earlyBirdPromoEnrollments.claimLeaseOwner, input.workerId),
      )).returning({ id: earlyBirdPromoEnrollments.id }))[0];
      if (!attached) throw new Error("EARLY_BIRD_PROMO_REMINDER_ATTACH_FAILED");
      return { draftId: draft.id, followUpId: followUp.id };
    });
  }
}
