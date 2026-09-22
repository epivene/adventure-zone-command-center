import { and, asc, eq, gte, inArray, lte, or } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { eventDateCoverageItems, eventDateCoverageRuns } from "@/db/schema";
import type { CoverageDatabase } from "./event-date-repository";

type Database = PgDatabase<any, any, any>;
export type CoverageJobItem = typeof eventDateCoverageItems.$inferSelect;

export class CoverageJobRepository {
  constructor(private readonly database: Database) {}

  async createRun(input: { organizationIds: string[]; requestedBy: string | null; batchSize?: number }) {
    const batchSize = input.batchSize ?? 25;
    const organizationIds = [...new Set(input.organizationIds)].slice(0, batchSize);
    return this.database.transaction(async (tx) => {
      const [run] = await tx.insert(eventDateCoverageRuns).values({
        batchSize, requestedBy: input.requestedBy,
        selectedOrganizationIds: organizationIds,
      }).returning();
      if (!run) throw new Error("Failed to create coverage run");
      if (organizationIds.length) await tx.insert(eventDateCoverageItems).values(
        organizationIds.map((organizationId) => ({ runId: run.id, organizationId })),
      ).onConflictDoNothing();
      return run;
    });
  }

  async getRun(runId: string) {
    const [run] = await this.database.select().from(eventDateCoverageRuns).where(eq(eventDateCoverageRuns.id, runId));
    if (!run) return null;
    const items = await this.database.select().from(eventDateCoverageItems)
      .where(eq(eventDateCoverageItems.runId, runId)).orderBy(asc(eventDateCoverageItems.createdAt), asc(eventDateCoverageItems.id));
    return { ...run, items };
  }

  async getItem(itemId: string) {
    const [item] = await this.database.select().from(eventDateCoverageItems).where(eq(eventDateCoverageItems.id, itemId));
    return item ?? null;
  }

  async claimNext(input: { workerId: string; now: Date; leaseMs: number; maxAttempts: number }): Promise<CoverageJobItem | null> {
    return this.database.transaction(async (tx) => {
      const [item] = await tx.select().from(eventDateCoverageItems)
        .where(and(
          or(
            eq(eventDateCoverageItems.status, "queued"),
            and(eq(eventDateCoverageItems.status, "researching"), lte(eventDateCoverageItems.leaseExpiresAt, input.now)),
          ),
          lte(eventDateCoverageItems.attempts, input.maxAttempts - 1),
        ))
        .orderBy(asc(eventDateCoverageItems.createdAt), asc(eventDateCoverageItems.id))
        .limit(1).for("update", { skipLocked: true });
      if (!item) return null;
      const leaseExpiresAt = new Date(input.now.getTime() + input.leaseMs);
      const [claimed] = await tx.update(eventDateCoverageItems).set({
        status: "researching", attempts: item.attempts + 1,
        leaseOwner: input.workerId, leaseExpiresAt,
        startedAt: item.startedAt ?? input.now, updatedAt: input.now, errorDetail: null,
      }).where(eq(eventDateCoverageItems.id, item.id)).returning();
      await tx.update(eventDateCoverageRuns).set({ status: "researching", startedAt: input.now, updatedAt: input.now })
        .where(and(eq(eventDateCoverageRuns.id, item.runId), eq(eventDateCoverageRuns.status, "queued")));
      return claimed ?? null;
    });
  }

  async renewLease(itemId: string, workerId: string, now: Date, leaseMs: number) {
    const [item] = await this.database.update(eventDateCoverageItems).set({
      leaseExpiresAt: new Date(now.getTime() + leaseMs),
      updatedAt: now,
    }).where(and(
      eq(eventDateCoverageItems.id, itemId),
      eq(eventDateCoverageItems.status, "researching"),
      eq(eventDateCoverageItems.leaseOwner, workerId),
      gte(eventDateCoverageItems.leaseExpiresAt, now),
    )).returning();
    return item ?? null;
  }

  async completeItem(itemId: string, status: "complete" | "needs_review" | "skipped", now: Date, workerId: string) {
    const [item] = await this.database.update(eventDateCoverageItems).set({
      status, completedAt: now, leaseOwner: null, leaseExpiresAt: null, updatedAt: now,
    }).where(and(
      eq(eventDateCoverageItems.id, itemId),
      eq(eventDateCoverageItems.status, "researching"),
      eq(eventDateCoverageItems.leaseOwner, workerId),
      gte(eventDateCoverageItems.leaseExpiresAt, now),
    )).returning();
    if (item) await this.finishRunIfSettled(item.runId, now);
    return item ?? null;
  }

  async completeWithLease(
    itemId: string,
    status: "complete" | "needs_review" | "skipped",
    now: Date,
    workerId: string,
    leaseMs: number,
    work: (transaction: CoverageDatabase) => Promise<void>,
  ) {
    return this.database.transaction(async (transaction) => {
      const [owned] = await transaction.select().from(eventDateCoverageItems).where(and(
        eq(eventDateCoverageItems.id, itemId),
        eq(eventDateCoverageItems.status, "researching"),
        eq(eventDateCoverageItems.leaseOwner, workerId),
        gte(eventDateCoverageItems.leaseExpiresAt, now),
      )).for("update");
      if (!owned) return null;
      await transaction.update(eventDateCoverageItems).set({
        leaseExpiresAt: new Date(now.getTime() + leaseMs),
        updatedAt: now,
      }).where(eq(eventDateCoverageItems.id, itemId));
      await work(transaction as CoverageDatabase);
      const [completed] = await transaction.update(eventDateCoverageItems).set({
        status, completedAt: now, leaseOwner: null, leaseExpiresAt: null, updatedAt: now,
      }).where(eq(eventDateCoverageItems.id, itemId)).returning();
      await this.finishRunIfSettled(owned.runId, now, transaction as Database);
      return completed ?? null;
    });
  }

  async failItem(itemId: string, errorDetail: string, now: Date, maxAttempts: number, workerId: string) {
    const item = await this.getItem(itemId);
    if (!item) return null;
    const status = item.attempts >= maxAttempts ? "failed" : "queued";
    const [updated] = await this.database.update(eventDateCoverageItems).set({
      status, errorDetail, completedAt: status === "failed" ? now : null,
      leaseOwner: null, leaseExpiresAt: null, updatedAt: now,
    }).where(and(
      eq(eventDateCoverageItems.id, itemId),
      eq(eventDateCoverageItems.status, "researching"),
      eq(eventDateCoverageItems.leaseOwner, workerId),
      gte(eventDateCoverageItems.leaseExpiresAt, now),
    )).returning();
    if (!updated) return null;
    if (status === "failed") await this.finishRunIfSettled(item.runId, now);
    return updated;
  }

  async retryItem(itemId: string) {
    const [item] = await this.database.update(eventDateCoverageItems).set({
      status: "queued", attempts: 0, errorDetail: null, completedAt: null,
      leaseOwner: null, leaseExpiresAt: null, updatedAt: new Date(),
    }).where(and(
      eq(eventDateCoverageItems.id, itemId),
      eq(eventDateCoverageItems.status, "failed"),
    )).returning();
    if (item) await this.database.update(eventDateCoverageRuns).set({ status: "queued", completedAt: null, errorDetail: null, updatedAt: new Date() })
      .where(eq(eventDateCoverageRuns.id, item.runId));
    return item ?? null;
  }

  async cancelRun(runId: string) {
    const now = new Date();
    return this.database.transaction(async (tx) => {
      await tx.update(eventDateCoverageItems).set({ status: "skipped", completedAt: now, leaseOwner: null, leaseExpiresAt: null, updatedAt: now })
        .where(and(eq(eventDateCoverageItems.runId, runId), inArray(eventDateCoverageItems.status, ["queued", "researching"])));
      const [run] = await tx.update(eventDateCoverageRuns).set({ status: "cancelled", completedAt: now, updatedAt: now })
        .where(eq(eventDateCoverageRuns.id, runId)).returning();
      return run ?? null;
    });
  }

  private async finishRunIfSettled(runId: string, now: Date, database: Database = this.database) {
    const remaining = await database.select({ id: eventDateCoverageItems.id }).from(eventDateCoverageItems)
      .where(and(eq(eventDateCoverageItems.runId, runId), inArray(eventDateCoverageItems.status, ["queued", "researching"]))).limit(1);
    if (!remaining.length) await database.update(eventDateCoverageRuns).set({ status: "complete", completedAt: now, updatedAt: now })
      .where(and(
        eq(eventDateCoverageRuns.id, runId),
        inArray(eventDateCoverageRuns.status, ["queued", "researching"]),
      ));
  }
}
