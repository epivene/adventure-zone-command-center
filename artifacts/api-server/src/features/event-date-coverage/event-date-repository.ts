import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";

import {
  eventDateFacts,
  type EventDateFactStatus,
  type EventDateRecurrenceRule,
  type EventDateSourceKind,
  type EventDateSourcePointer,
} from "@workspace/db/event-date-coverage-schema";

export type EventDateFact = typeof eventDateFacts.$inferSelect;

export type NewEventDateFact = {
  organizationId: string;
  startsOn: string;
  endsOn: string | null;
  status: Exclude<EventDateFactStatus, "needs_review">;
  recurrenceRule: EventDateRecurrenceRule | null;
  rationale: string;
  sourceKind: EventDateSourceKind;
  sourceTitle: string;
  sourceUrl: string | null;
  sourceRecordType: string | null;
  sourceRecordId: string | null;
  sourcePointers: EventDateSourcePointer[];
  researchedAt: Date;
  verifiedAt: Date | null;
  createdBy: string | null;
};

export type NeedsReviewFact = Omit<NewEventDateFact, "status">;

type CoverageDatabase = PgDatabase<any, any, any>;

export class EventDateRepository {
  constructor(private readonly database: CoverageDatabase) {}

  async listFacts(organizationId: string): Promise<EventDateFact[]> {
    return this.database
      .select()
      .from(eventDateFacts)
      .where(eq(eventDateFacts.organizationId, organizationId))
      .orderBy(desc(eventDateFacts.createdAt), desc(eventDateFacts.id));
  }

  async listActiveFacts(
    organizationIds: string[],
  ): Promise<Map<string, EventDateFact[]>> {
    if (!organizationIds.length) return new Map();
    const rows = await this.database
      .select()
      .from(eventDateFacts)
      .where(and(
        inArray(eventDateFacts.organizationId, organizationIds),
        eq(eventDateFacts.active, true),
      ))
      .orderBy(
        asc(eventDateFacts.organizationId),
        asc(eventDateFacts.startsOn),
        asc(eventDateFacts.id),
      );
    const result = new Map<string, EventDateFact[]>();
    for (const row of rows) {
      const existing = result.get(row.organizationId) ?? [];
      existing.push(row);
      result.set(row.organizationId, existing);
    }
    return result;
  }

  async supersedeActiveFact(input: NewEventDateFact): Promise<EventDateFact> {
    return this.database.transaction(async (transaction) => {
      const activeRows = await transaction
        .select({ id: eventDateFacts.id })
        .from(eventDateFacts)
        .where(and(
          eq(eventDateFacts.organizationId, input.organizationId),
          eq(eventDateFacts.active, true),
        ))
        .for("update");
      const now = new Date();
      if (activeRows.length) {
        await transaction
          .update(eventDateFacts)
          .set({ active: false, updatedAt: now })
          .where(and(
            eq(eventDateFacts.organizationId, input.organizationId),
            eq(eventDateFacts.active, true),
          ));
      }
      const [created] = await transaction
        .insert(eventDateFacts)
        .values({
          ...input,
          active: true,
          supersededById: null,
          updatedAt: now,
        })
        .returning();
      if (!created) throw new Error("Failed to create event date fact");
      if (activeRows.length) {
        await transaction
          .update(eventDateFacts)
          .set({ supersededById: created.id, updatedAt: now })
          .where(inArray(eventDateFacts.id, activeRows.map((row) => row.id)));
      }
      return created;
    });
  }

  async markNeedsReview(input: NeedsReviewFact): Promise<EventDateFact> {
    const [created] = await this.database
      .insert(eventDateFacts)
      .values({
        ...input,
        status: "needs_review",
        active: false,
        supersededById: null,
      })
      .returning();
    if (!created) throw new Error("Failed to create event date review fact");
    return created;
  }
}
