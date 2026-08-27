import { and, eq, inArray, notInArray } from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  bookingOpportunities,
  bookingOpportunityQueueOverrides,
} from "@/db/schema";

const closedOpportunityStatuses = [
  "not_pursuing",
  "declined",
  "no_response",
  "territory_hold",
  "cancelled",
] as const;

type DrizzleDatabase = typeof database;

export interface TodayWorkControls {
  pin(opportunityId: string, businessDate: string, pinned: boolean): Promise<boolean>;
  urgent(opportunityId: string, urgent: boolean): Promise<boolean>;
  snooze(opportunityId: string, businessDate: string, until: Date): Promise<boolean>;
  reorder(opportunityIds: string[], businessDate: string): Promise<boolean>;
  resetOrder(businessDate: string): Promise<void>;
}

export class DrizzleTodayWorkControls implements TodayWorkControls {
  constructor(private readonly database: DrizzleDatabase) {}

  private async visibleOpportunityIds(ids: string[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const rows = await this.database
      .select({ id: bookingOpportunities.id })
      .from(bookingOpportunities)
      .where(
        and(
          inArray(bookingOpportunities.id, ids),
          notInArray(bookingOpportunities.status, closedOpportunityStatuses),
        ),
      );
    return new Set(rows.map(({ id }) => id));
  }

  private async isVisible(id: string): Promise<boolean> {
    return (await this.visibleOpportunityIds([id])).has(id);
  }

  async pin(
    opportunityId: string,
    businessDate: string,
    pinned: boolean,
  ): Promise<boolean> {
    if (!(await this.isVisible(opportunityId))) return false;
    const now = new Date();
    await this.database
      .insert(bookingOpportunityQueueOverrides)
      .values({ opportunityId, businessDate, pinned, updatedAt: now })
      .onConflictDoUpdate({
        target: [
          bookingOpportunityQueueOverrides.opportunityId,
          bookingOpportunityQueueOverrides.businessDate,
        ],
        set: { pinned, updatedAt: now },
      });
    return true;
  }

  async urgent(opportunityId: string, urgent: boolean): Promise<boolean> {
    const rows = await this.database
      .update(bookingOpportunities)
      .set({ priority: urgent ? "urgent" : "normal", updatedAt: new Date() })
      .where(
        and(
          eq(bookingOpportunities.id, opportunityId),
          notInArray(bookingOpportunities.status, closedOpportunityStatuses),
        ),
      )
      .returning({ id: bookingOpportunities.id });
    return rows.length === 1;
  }

  async snooze(
    opportunityId: string,
    businessDate: string,
    until: Date,
  ): Promise<boolean> {
    if (!(await this.isVisible(opportunityId))) return false;
    const now = new Date();
    await this.database
      .insert(bookingOpportunityQueueOverrides)
      .values({
        opportunityId,
        businessDate,
        snoozedUntil: until,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          bookingOpportunityQueueOverrides.opportunityId,
          bookingOpportunityQueueOverrides.businessDate,
        ],
        set: { snoozedUntil: until, updatedAt: now },
      });
    return true;
  }

  async reorder(
    opportunityIds: string[],
    businessDate: string,
  ): Promise<boolean> {
    const visible = await this.visibleOpportunityIds(opportunityIds);
    if (visible.size !== opportunityIds.length) return false;

    await this.database.transaction(async (transaction) => {
      const now = new Date();
      for (const [manualOrder, opportunityId] of opportunityIds.entries()) {
        await transaction
          .insert(bookingOpportunityQueueOverrides)
          .values({ opportunityId, businessDate, manualOrder, updatedAt: now })
          .onConflictDoUpdate({
            target: [
              bookingOpportunityQueueOverrides.opportunityId,
              bookingOpportunityQueueOverrides.businessDate,
            ],
            set: { manualOrder, updatedAt: now },
          });
      }
    });
    return true;
  }

  async resetOrder(businessDate: string): Promise<void> {
    await this.database
      .update(bookingOpportunityQueueOverrides)
      .set({ manualOrder: null, updatedAt: new Date() })
      .where(eq(bookingOpportunityQueueOverrides.businessDate, businessDate));
  }
}
