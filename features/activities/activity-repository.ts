import { count, desc, eq, or } from "drizzle-orm";

import type { db as database } from "@/db/client";
import { activities, activityRevisions } from "@/db/schema";
import { recordAuditEntry } from "@/features/audit/audit-service";
import { err, ok, type Result } from "@/lib/result";

import type {
  ActivityError,
  ActivityParent,
  ActivityRevision,
  ActivityTimelineItem,
  CreateActivityInput,
  EditActivityInput,
} from "@/features/activities/activity-types";

export type {
  ActivityError,
  ActivityParent,
  ActivityRevision,
  ActivityTimelineItem,
  CreateActivityInput,
  EditActivityInput,
};

export interface ActivityRepository {
  listTimeline(parent: ActivityParent): Promise<ActivityTimelineItem[]>;
  create(input: CreateActivityInput): Promise<ActivityTimelineItem>;
  edit(input: EditActivityInput): Promise<Result<ActivityTimelineItem, ActivityError>>;
}

export interface ActivityRevisionReader {
  listRevisions(activityId: string): Promise<ActivityRevision[]>;
}

type DrizzleDatabase = typeof database;

function toTimelineItem(
  activity: typeof activities.$inferSelect,
  revisionCount: number,
): ActivityTimelineItem {
  return {
    id: activity.id,
    organizationId: activity.organizationId,
    contactId: activity.contactId,
    bookingId: activity.bookingId,
    kind: activity.kind,
    body: activity.body,
    occurredAt: activity.occurredAt,
    createdAt: activity.createdAt,
    updatedAt: activity.updatedAt,
    revisionCount,
  };
}

function toRevision(revision: typeof activityRevisions.$inferSelect): ActivityRevision {
  return {
    id: revision.id,
    activityId: revision.activityId,
    priorBody: revision.priorBody,
    replacementBody: revision.replacementBody,
    reason: revision.reason,
    createdAt: revision.createdAt,
  };
}

function activitySnapshot(activity: typeof activities.$inferSelect) {
  return {
    organizationId: activity.organizationId,
    contactId: activity.contactId,
    bookingId: activity.bookingId,
    kind: activity.kind,
    body: activity.body,
    occurredAt: activity.occurredAt.toISOString(),
  };
}

function timelineCondition(parent: ActivityParent) {
  const conditions = [
    parent.organizationId ? eq(activities.organizationId, parent.organizationId) : undefined,
    parent.contactId ? eq(activities.contactId, parent.contactId) : undefined,
    parent.bookingId ? eq(activities.bookingId, parent.bookingId) : undefined,
  ].filter((condition) => condition !== undefined);
  return conditions.length ? or(...conditions) : undefined;
}

export class DrizzleActivityRepository
  implements ActivityRepository, ActivityRevisionReader
{
  constructor(private readonly database: DrizzleDatabase) {}

  async listTimeline(parent: ActivityParent): Promise<ActivityTimelineItem[]> {
    const condition = timelineCondition(parent);
    if (!condition) return [];

    const records = await this.database
      .select({ activity: activities, revisionCount: count(activityRevisions.id) })
      .from(activities)
      .leftJoin(activityRevisions, eq(activityRevisions.activityId, activities.id))
      .where(condition)
      .groupBy(activities.id)
      .orderBy(desc(activities.occurredAt), desc(activities.createdAt), desc(activities.id));

    return records.map(({ activity, revisionCount }) =>
      toTimelineItem(activity, Number(revisionCount)),
    );
  }

  async listRevisions(activityId: string): Promise<ActivityRevision[]> {
    const revisions = await this.database
      .select()
      .from(activityRevisions)
      .where(eq(activityRevisions.activityId, activityId))
      .orderBy(desc(activityRevisions.createdAt), desc(activityRevisions.id));
    return revisions.map(toRevision);
  }

  async create(input: CreateActivityInput): Promise<ActivityTimelineItem> {
    return this.database.transaction(async (transaction) => {
      const now = new Date();
      const [activity] = await transaction
        .insert(activities)
        .values({ ...input, createdAt: now, updatedAt: now })
        .returning();
      if (!activity) throw new Error("Could not create activity.");

      await recordAuditEntry(transaction, {
        entityType: "activity",
        entityId: activity.id,
        action: "create",
        before: null,
        after: activitySnapshot(activity),
      });
      return toTimelineItem(activity, 0);
    });
  }

  async edit(
    input: EditActivityInput,
  ): Promise<Result<ActivityTimelineItem, ActivityError>> {
    return this.database.transaction(async (transaction) => {
      const [before] = await transaction
        .select()
        .from(activities)
        .where(eq(activities.id, input.activityId))
        .limit(1)
        .for("update");
      if (!before) return err({ code: "ACTIVITY_NOT_FOUND" });

      const now = new Date();
      await transaction.insert(activityRevisions).values({
        activityId: before.id,
        priorBody: before.body,
        replacementBody: input.body,
        reason: input.reason,
        createdAt: now,
      });
      const [updated] = await transaction
        .update(activities)
        .set({ body: input.body, updatedAt: now })
        .where(eq(activities.id, before.id))
        .returning();
      if (!updated) throw new Error("Activity disappeared while being edited.");

      await recordAuditEntry(transaction, {
        entityType: "activity",
        entityId: updated.id,
        action: "update",
        before: activitySnapshot(before),
        after: activitySnapshot(updated),
      });

      const [revisionTotal] = await transaction
        .select({ value: count() })
        .from(activityRevisions)
        .where(eq(activityRevisions.activityId, updated.id));
      return ok(toTimelineItem(updated, revisionTotal?.value ?? 0));
    });
  }
}
