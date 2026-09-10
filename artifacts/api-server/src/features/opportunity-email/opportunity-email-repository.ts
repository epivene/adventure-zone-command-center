import { and, desc, eq, inArray, lte, or, sql } from "drizzle-orm";

import type { db as database } from "@/db/client";
import { bookingOpportunityEmailState } from "@/db/schema";
import type {
  CreateOpportunityEmailInput,
  OpportunityEmailRecord,
  UpdateOpportunityEmailInput,
} from "./opportunity-email-types";

type DrizzleDatabase = typeof database;
type OpportunityEmailRow = typeof bookingOpportunityEmailState.$inferSelect;
const DISPATCH_LEASE_MS = 60_000;

function toRecord(row: OpportunityEmailRow): OpportunityEmailRecord {
  return {
    id: row.id,
    opportunityId: row.opportunityId,
    organizationId: row.organizationId,
    contactId: row.contactId,
    eventYear: row.eventYear,
    purpose: row.purpose,
    state: row.state,
    gmailDraftId: row.gmailDraftId,
    gmailMessageId: row.gmailMessageId,
    gmailThreadId: row.gmailThreadId,
    recipientEmail: row.recipientEmail,
    recipientName: row.recipientName,
    subject: row.subject,
    body: row.body,
    scheduledFor: row.scheduledFor,
    sentAt: row.sentAt,
    lastFailureCode: row.lastFailureCode,
    lastFailureMessage: row.lastFailureMessage,
    sendRequestKey: row.sendRequestKey,
    scheduleRequestKey: row.scheduleRequestKey,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class OpportunityEmailRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async getCurrentForOpportunity(
    opportunityId: string,
  ): Promise<OpportunityEmailRecord | null> {
    const [row] = await this.database
      .select()
      .from(bookingOpportunityEmailState)
      .where(eq(bookingOpportunityEmailState.opportunityId, opportunityId))
      .orderBy(desc(bookingOpportunityEmailState.updatedAt))
      .limit(1);
    if (!row || !["draft", "scheduled", "failed"].includes(row.state))
      return null;
    return toRecord(row);
  }

  async getById(id: string): Promise<OpportunityEmailRecord | null> {
    const [row] = await this.database
      .select()
      .from(bookingOpportunityEmailState)
      .where(eq(bookingOpportunityEmailState.id, id))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  async create(
    input: CreateOpportunityEmailInput,
  ): Promise<OpportunityEmailRecord> {
    const [row] = await this.database
      .insert(bookingOpportunityEmailState)
      .values({
        opportunityId: input.opportunityId,
        organizationId: input.organizationId,
        contactId: input.contactId ?? null,
        eventYear: input.eventYear,
        purpose: input.purpose,
        state: input.state ?? "draft",
        gmailDraftId: input.gmailDraftId ?? null,
        gmailMessageId: input.gmailMessageId ?? null,
        gmailThreadId: input.gmailThreadId ?? null,
        recipientEmail: input.recipientEmail,
        recipientName: input.recipientName ?? null,
        subject: input.subject,
        body: input.body,
        scheduledFor: input.scheduledFor ?? null,
        sentAt: input.sentAt ?? null,
        lastFailureCode: input.lastFailureCode ?? null,
        lastFailureMessage: input.lastFailureMessage ?? null,
        sendRequestKey: input.sendRequestKey ?? null,
        scheduleRequestKey: input.scheduleRequestKey ?? null,
      })
      .returning();
    if (!row) throw new Error("Could not create opportunity email state");
    return toRecord(row);
  }

  async update(
    id: string,
    patch: UpdateOpportunityEmailInput,
    now = new Date(),
  ): Promise<OpportunityEmailRecord> {
    const values: Partial<typeof bookingOpportunityEmailState.$inferInsert> = {
      updatedAt: now,
    };
    for (const key of [
      "contactId",
      "purpose",
      "state",
      "gmailDraftId",
      "gmailMessageId",
      "gmailThreadId",
      "recipientEmail",
      "recipientName",
      "subject",
      "body",
      "scheduledFor",
      "sentAt",
      "lastFailureCode",
      "lastFailureMessage",
      "sendRequestKey",
      "scheduleRequestKey",
    ] as const) {
      if (patch[key] !== undefined)
        (values as Record<string, unknown>)[key] = patch[key];
    }
    const [row] = await this.database
      .update(bookingOpportunityEmailState)
      .set(values)
      .where(eq(bookingOpportunityEmailState.id, id))
      .returning();
    if (!row) throw new Error(`Opportunity email not found: ${id}`);
    return toRecord(row);
  }

  async findBySendRequestKey(
    requestKey: string,
  ): Promise<OpportunityEmailRecord | null> {
    const [row] = await this.database
      .select()
      .from(bookingOpportunityEmailState)
      .where(eq(bookingOpportunityEmailState.sendRequestKey, requestKey))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  async findByScheduleRequestKey(
    requestKey: string,
  ): Promise<OpportunityEmailRecord | null> {
    const [row] = await this.database
      .select()
      .from(bookingOpportunityEmailState)
      .where(eq(bookingOpportunityEmailState.scheduleRequestKey, requestKey))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  async listReadyToSend(): Promise<OpportunityEmailRecord[]> {
    const rows = await this.database
      .select()
      .from(bookingOpportunityEmailState)
      .where(
        inArray(bookingOpportunityEmailState.state, [
          "draft",
          "scheduled",
          "failed",
        ]),
      )
      .orderBy(desc(bookingOpportunityEmailState.updatedAt));
    return rows.map(toRecord);
  }

  async claimOneDue(input: {
    workerId: string;
    now: Date;
  }): Promise<OpportunityEmailRecord | null> {
    const leaseExpiresAt = new Date(input.now.getTime() + DISPATCH_LEASE_MS);
    return this.database.transaction(async (tx) => {
      const [candidate] = await tx
        .select({ id: bookingOpportunityEmailState.id })
        .from(bookingOpportunityEmailState)
        .where(
          and(
            eq(bookingOpportunityEmailState.state, "scheduled"),
            process.env.OUTREACH_PLANNER_ENABLED === "true"
              ? sql`not exists(select 1 from outreach_dispatches d where d.draft_kind='opportunity_email' and d.draft_id=${bookingOpportunityEmailState.id} and d.state in ('dispatching','uncertain'))`
              : undefined,
            lte(bookingOpportunityEmailState.scheduledFor, input.now),
            or(
              sql`${bookingOpportunityEmailState.dispatchLeaseExpiresAt} is null`,
              lte(
                bookingOpportunityEmailState.dispatchLeaseExpiresAt,
                input.now,
              ),
            ),
          ),
        )
        .orderBy(
          bookingOpportunityEmailState.scheduledFor,
          bookingOpportunityEmailState.id,
        )
        .limit(1)
        .for("update", { skipLocked: true });
      if (!candidate) return null;

      const [claimed] = await tx
        .update(bookingOpportunityEmailState)
        .set({
          dispatchLeaseOwner: input.workerId,
          dispatchLeaseExpiresAt: leaseExpiresAt,
          dispatchAttemptCount: sql`${bookingOpportunityEmailState.dispatchAttemptCount} + 1`,
          updatedAt: input.now,
        })
        .where(eq(bookingOpportunityEmailState.id, candidate.id))
        .returning();
      return claimed ? toRecord(claimed) : null;
    });
  }

  async releaseLease(
    draftId: string,
    workerId: string,
    now: Date,
  ): Promise<void> {
    await this.database
      .update(bookingOpportunityEmailState)
      .set({
        dispatchLeaseOwner: null,
        dispatchLeaseExpiresAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(bookingOpportunityEmailState.id, draftId),
          eq(bookingOpportunityEmailState.dispatchLeaseOwner, workerId),
        ),
      );
  }
}
