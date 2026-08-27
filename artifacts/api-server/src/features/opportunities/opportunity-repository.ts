import { and, eq } from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  bookingOpportunities,
  bookingOpportunityQueueOverrides,
} from "@/db/schema";
import type {
  CreateOpportunityInput,
  OpportunityRecord,
  QueueOverride,
  UpdateOpportunityInput,
} from "./opportunity-types";

type DrizzleDatabase = typeof database;
type OpportunityRow = typeof bookingOpportunities.$inferSelect;
type QueueOverrideRow = typeof bookingOpportunityQueueOverrides.$inferSelect;

function toOpportunityRecord(row: OpportunityRow): OpportunityRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    eventYear: row.eventYear,
    bookingId: row.bookingId,
    contactId: row.contactId,
    status: row.status,
    priority: row.priority,
    nextActionKind: row.nextActionKind,
    nextActionDueAt: row.nextActionDueAt,
    holdReason: row.holdReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toQueueOverride(row: QueueOverrideRow): QueueOverride {
  return {
    opportunityId: row.opportunityId,
    businessDate: row.businessDate,
    pinned: row.pinned,
    manualOrder: row.manualOrder,
    snoozedUntil: row.snoozedUntil,
  };
}

export class OpportunityRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async get(id: string): Promise<OpportunityRecord | null> {
    const [row] = await this.database
      .select()
      .from(bookingOpportunities)
      .where(eq(bookingOpportunities.id, id))
      .limit(1);

    return row ? toOpportunityRecord(row) : null;
  }

  async getForOrganizationYear(
    organizationId: string,
    eventYear: number,
  ): Promise<OpportunityRecord | null> {
    const [row] = await this.database
      .select()
      .from(bookingOpportunities)
      .where(
        and(
          eq(bookingOpportunities.organizationId, organizationId),
          eq(bookingOpportunities.eventYear, eventYear),
        ),
      )
      .limit(1);

    return row ? toOpportunityRecord(row) : null;
  }

  async create(input: CreateOpportunityInput): Promise<OpportunityRecord> {
    const [row] = await this.database
      .insert(bookingOpportunities)
      .values({
        organizationId: input.organizationId,
        eventYear: input.eventYear,
        bookingId: input.bookingId ?? null,
        contactId: input.contactId ?? null,
        status: input.status ?? "new_lead",
        priority: input.priority ?? "normal",
        nextActionKind: input.nextActionKind ?? null,
        nextActionDueAt: input.nextActionDueAt ?? null,
        holdReason: input.holdReason ?? null,
      })
      .returning();

    if (!row) throw new Error("Could not create booking opportunity");
    return toOpportunityRecord(row);
  }

  async update(
    id: string,
    patch: UpdateOpportunityInput,
    now = new Date(),
  ): Promise<OpportunityRecord> {
    const values: Partial<typeof bookingOpportunities.$inferInsert> = {
      updatedAt: now,
    };

    if (patch.bookingId !== undefined) values.bookingId = patch.bookingId;
    if (patch.contactId !== undefined) values.contactId = patch.contactId;
    if (patch.status !== undefined) values.status = patch.status;
    if (patch.priority !== undefined) values.priority = patch.priority;
    if (patch.nextActionKind !== undefined) {
      values.nextActionKind = patch.nextActionKind;
    }
    if (patch.nextActionDueAt !== undefined) {
      values.nextActionDueAt = patch.nextActionDueAt;
    }
    if (patch.holdReason !== undefined) values.holdReason = patch.holdReason;

    const [row] = await this.database
      .update(bookingOpportunities)
      .set(values)
      .where(eq(bookingOpportunities.id, id))
      .returning();

    if (!row) throw new Error(`Booking opportunity not found: ${id}`);
    return toOpportunityRecord(row);
  }

  async getQueueOverride(
    opportunityId: string,
    businessDate: string,
  ): Promise<QueueOverride | null> {
    const [row] = await this.database
      .select()
      .from(bookingOpportunityQueueOverrides)
      .where(
        and(
          eq(
            bookingOpportunityQueueOverrides.opportunityId,
            opportunityId,
          ),
          eq(bookingOpportunityQueueOverrides.businessDate, businessDate),
        ),
      )
      .limit(1);

    return row ? toQueueOverride(row) : null;
  }

  async upsertQueueOverride(
    input: QueueOverride,
    now = new Date(),
  ): Promise<QueueOverride> {
    const [row] = await this.database
      .insert(bookingOpportunityQueueOverrides)
      .values({
        opportunityId: input.opportunityId,
        businessDate: input.businessDate,
        pinned: input.pinned,
        manualOrder: input.manualOrder,
        snoozedUntil: input.snoozedUntil,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          bookingOpportunityQueueOverrides.opportunityId,
          bookingOpportunityQueueOverrides.businessDate,
        ],
        set: {
          pinned: input.pinned,
          manualOrder: input.manualOrder,
          snoozedUntil: input.snoozedUntil,
          updatedAt: now,
        },
      })
      .returning();

    if (!row) throw new Error("Could not save booking opportunity queue override");
    return toQueueOverride(row);
  }
}
