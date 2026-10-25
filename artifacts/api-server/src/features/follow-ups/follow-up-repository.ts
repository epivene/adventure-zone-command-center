import { and, eq, isNull, or } from "drizzle-orm";

import type { db as database } from "@/db/client";
import { callSessions, followUps } from "@/db/schema";
import { recordAuditEntry } from "@/features/audit/audit-service";
import type {
  CreateFollowUpInput,
  EditFollowUpInput,
  FollowUpError,
  FollowUpRecord,
} from "@/features/follow-ups/follow-up-types";
import { err, ok, type Result } from "@/lib/result";

export type { CreateFollowUpInput, EditFollowUpInput, FollowUpError, FollowUpRecord };

export type FollowUpCreateOptions = {preserveExisting?:boolean;idempotencyId?:string};

export interface FollowUpRepository {
  create(
    input: CreateFollowUpInput,
    options?: FollowUpCreateOptions,
  ): Promise<Result<FollowUpRecord, FollowUpError>>;
  edit(
    input: EditFollowUpInput,
  ): Promise<Result<FollowUpRecord, FollowUpError>>;
  delete(followUpId: string): Promise<Result<void, FollowUpError>>;
}

type DrizzleDatabase = typeof database;
type FollowUpRow = typeof followUps.$inferSelect;

function toFollowUpRecord(row: FollowUpRow): FollowUpRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    contactId: row.contactId,
    bookingId: row.bookingId,
    kind: row.kind,
    dueAt: row.dueAt,
    completedAt: row.completedAt,
    outcome: row.outcome,
  };
}

export class DrizzleFollowUpRepository implements FollowUpRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async create(
    input: CreateFollowUpInput,
    options?: FollowUpCreateOptions,
  ): Promise<Result<FollowUpRecord, FollowUpError>> {
    return this.database.transaction(async (transaction) => {
      const now = new Date();

      if (options?.idempotencyId) {
        const [prior]=await transaction.select().from(followUps).where(eq(followUps.id,options.idempotencyId)).limit(1);
        if(prior) {
          if(prior.organizationId!==input.organizationId||prior.bookingId!==input.bookingId||prior.kind!==input.kind||prior.dueAt.getTime()!==input.dueAt.getTime()) return err({code:"INVALID_FOLLOW_UP_INPUT",message:"Reminder request conflicts with a previous action."});
          return ok(toFollowUpRecord(prior));
        }
      }
      // Replacing every open reminder must be an explicit caller decision.
      // Creating a new action otherwise preserves independent booking work.
      if (input.bookingId && options?.preserveExisting === false) {
        await transaction
          .update(followUps)
          .set({
            completedAt: now,
            outcome: "Replaced by newer follow-up",
            updatedAt: now,
          })
          .where(
            and(
              eq(followUps.bookingId, input.bookingId),
              isNull(followUps.completedAt),
            ),
          );
      }

      const [created] = await transaction
        .insert(followUps)
        .values({
          ...(options?.idempotencyId?{id:options.idempotencyId}:{}),
          organizationId: input.organizationId,
          contactId: input.contactId,
          bookingId: input.bookingId,
          kind: input.kind,
          dueAt: input.dueAt,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      if (!created) {
        return err({
          code: "INVALID_FOLLOW_UP_INPUT",
          message: "Could not create follow-up.",
        });
      }

      return ok(toFollowUpRecord(created));
    });
  }

  async edit(
    input: EditFollowUpInput,
  ): Promise<Result<FollowUpRecord, FollowUpError>> {
    return this.database.transaction(async (transaction) => {
      const [current] = await transaction
        .select()
        .from(followUps)
        .where(eq(followUps.id, input.followUpId))
        .limit(1)
        .for("update");

      if (!current) {
        return err({ code: "FOLLOW_UP_NOT_FOUND" });
      }

      const [updated] = await transaction
        .update(followUps)
        .set({
          kind: input.kind,
          dueAt: input.dueAt,
          completedAt: input.completed ? new Date() : null,
          outcome: input.outcome,
          updatedAt: new Date(),
        })
        .where(eq(followUps.id, input.followUpId))
        .returning();

      if (!updated) {
        return err({ code: "FOLLOW_UP_NOT_FOUND" });
      }

      return ok(toFollowUpRecord(updated));
    });
  }

  async delete(followUpId: string): Promise<Result<void, FollowUpError>> {
    return this.database.transaction(async (transaction) => {
      const [target] = await transaction
        .select({ id: followUps.id })
        .from(followUps)
        .where(eq(followUps.id, followUpId))
        .limit(1)
        .for("update");

      if (!target) {
        return err({ code: "FOLLOW_UP_NOT_FOUND" });
      }

      await transaction
        .update(followUps)
        .set({ nextFollowUpId: null, updatedAt: new Date() })
        .where(eq(followUps.nextFollowUpId, followUpId));

      await transaction
        .update(callSessions)
        .set({ followUpId: null, nextFollowUpId: null })
        .where(
          or(
            eq(callSessions.followUpId, followUpId),
            eq(callSessions.nextFollowUpId, followUpId),
          ),
        );

      await recordAuditEntry(transaction, {
        entityType: "follow_up",
        entityId: followUpId,
        action: "delete",
        before: null,
        after: null,
      });

      await transaction
        .delete(followUps)
        .where(and(eq(followUps.id, followUpId)));

      return ok(undefined);
    });
  }
}

