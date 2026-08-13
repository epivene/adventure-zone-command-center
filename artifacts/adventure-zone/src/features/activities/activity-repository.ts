import { and, count, desc, eq } from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  activities,
  activityRevisions,
  bookingContacts,
  bookings,
  contacts,
  organizationContacts,
  organizations,
} from "@/db/schema";
import { recordAuditEntry } from "@/features/audit/audit-service";
import { err, ok, type Result } from "@/lib/result";

import type {
  ActivityError,
  ActivityParent,
  ActivityRevision,
  ActivityRevisionPage,
  ActivityTimelineItem,
  CreateActivityInput,
  EditActivityInput,
} from "@/features/activities/activity-types";

export type {
  ActivityError,
  ActivityParent,
  ActivityRevision,
  ActivityRevisionPage,
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
  listRevisions(
    activityId: string,
    page?: number,
  ): Promise<ActivityRevisionPage>;
}

type DrizzleDatabase = typeof database;
const REVISION_PAGE_SIZE = 25;

export class ActivityParentValidationError extends Error {
  constructor() {
    super("The linked CRM record could not be found or does not match.");
    this.name = "ActivityParentValidationError";
  }
}

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
    occurredAt: activity.occurredAt ?? activity.timelineSortAt,
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
    occurredAt: (activity.occurredAt ?? activity.timelineSortAt).toISOString(),
  };
}

function timelineCondition(parent: ActivityParent) {
  if (parent.bookingId) return eq(activities.bookingId, parent.bookingId);
  if (parent.contactId) return eq(activities.contactId, parent.contactId);
  return parent.organizationId ? eq(activities.organizationId, parent.organizationId) : undefined;
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
      .orderBy(desc(activities.timelineSortAt), desc(activities.createdAt), desc(activities.id))
      .limit(10);

    return records.map(({ activity, revisionCount }) =>
      toTimelineItem(activity, Number(revisionCount)),
    );
  }

  async listRevisions(
    activityId: string,
    page = 1,
  ): Promise<ActivityRevisionPage> {
    const records = await this.database
      .select()
      .from(activityRevisions)
      .where(eq(activityRevisions.activityId, activityId))
      .orderBy(desc(activityRevisions.createdAt), desc(activityRevisions.id))
      .limit(REVISION_PAGE_SIZE + 1)
      .offset((page - 1) * REVISION_PAGE_SIZE);
    return {
      revisions: records.slice(0, REVISION_PAGE_SIZE).map(toRevision),
      nextPage: records.length > REVISION_PAGE_SIZE ? page + 1 : null,
    };
  }

  async create(input: CreateActivityInput): Promise<ActivityTimelineItem> {
    return this.database.transaction(async (transaction) => {
      const [organization] = input.organizationId
        ? await transaction
          .select({ id: organizations.id })
          .from(organizations)
          .where(eq(organizations.id, input.organizationId))
          .limit(1)
          .for("update")
        : [];
      const [contact] = input.contactId
        ? await transaction
          .select({ id: contacts.id, organizationId: contacts.organizationId })
          .from(contacts)
          .where(eq(contacts.id, input.contactId))
          .limit(1)
          .for("update")
        : [];
      const [booking] = input.bookingId
        ? await transaction
          .select({ id: bookings.id, organizationId: bookings.organizationId })
          .from(bookings)
          .where(eq(bookings.id, input.bookingId))
          .limit(1)
          .for("update")
        : [];
      const [placePerson] =
        input.organizationId && input.contactId
          ? await transaction
            .select({ id: organizationContacts.id })
            .from(organizationContacts)
            .where(and(
              eq(organizationContacts.organizationId, input.organizationId),
              eq(organizationContacts.contactId, input.contactId),
              eq(organizationContacts.active, true),
            ))
            .limit(1)
            .for("share")
          : [];
      const [bookingPerson] =
        input.bookingId && input.contactId
          ? await transaction
            .select({ id: bookingContacts.id })
            .from(bookingContacts)
            .where(and(
              eq(bookingContacts.bookingId, input.bookingId),
              eq(bookingContacts.contactId, input.contactId),
            ))
            .limit(1)
            .for("share")
          : [];
      if (
        (input.organizationId && !organization) ||
        (input.contactId && !contact) ||
        (input.bookingId && !booking) ||
        (input.organizationId && input.contactId && !placePerson) ||
        (input.bookingId && input.contactId && !bookingPerson)
      ) {
        throw new ActivityParentValidationError();
      }
      const organizationIds = [
        input.organizationId,
        booking?.organizationId,
      ].filter((id): id is string => Boolean(id));
      if (new Set(organizationIds).size > 1) {
        throw new ActivityParentValidationError();
      }

      const now = new Date();
      const [activity] = await transaction
        .insert(activities)
        .values({
          ...input,
          timelineSortAt: input.occurredAt,
          createdAt: now,
          updatedAt: now,
        })
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
