"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type {
  ActivityMutationResult,
  ActivityRevisionResult,
} from "@/components/activities/activity-timeline";
import {
  createActivityInputSchema,
  editActivityInputSchema,
} from "@/features/activities/activity-input";
import { DrizzleActivityRepository } from "@/features/activities/activity-repository";
import { ActivityService } from "@/features/activities/activity-service";
import type {
  ActivityError,
  ActivityTimelineItem,
  CreateActivityInput,
  EditActivityInput,
} from "@/features/activities/activity-types";
import { requireOwner } from "@/lib/auth/require-owner";

function readableActivityError(error: ActivityError) {
  switch (error.code) {
    case "INVALID_ACTIVITY_INPUT":
      return error.message;
    case "ACTIVITY_NOT_FOUND":
      return "This activity could not be found. Refresh and try again.";
  }
}

function revalidateActivityParents(activity: ActivityTimelineItem) {
  revalidatePath("/calls/new");
  if (activity.organizationId) {
    revalidatePath("/organizations");
    revalidatePath(`/organizations/${activity.organizationId}`);
  }
  if (activity.contactId) {
    revalidatePath("/contacts");
    revalidatePath(`/contacts/${activity.contactId}`);
  }
  if (activity.bookingId) {
    revalidatePath("/bookings");
    revalidatePath(`/bookings/${activity.bookingId}`);
  }
}

async function activityService() {
  const { db } = await import("@/db/client");
  return new ActivityService(new DrizzleActivityRepository(db));
}

export async function createActivityAction(
  input: CreateActivityInput,
): Promise<ActivityMutationResult> {
  await requireOwner();
  const parsed = createActivityInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Review the activity details.",
    };
  }

  const result = await (await activityService()).create(parsed.data);
  if (!result.ok) return { ok: false, error: readableActivityError(result.error) };

  revalidateActivityParents(result.value);
  return { ok: true, activity: result.value };
}

export async function editActivityAction(
  input: EditActivityInput,
): Promise<ActivityMutationResult> {
  await requireOwner();
  const parsed = editActivityInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Review the activity edit.",
    };
  }

  const result = await (await activityService()).edit(parsed.data);
  if (!result.ok) return { ok: false, error: readableActivityError(result.error) };

  revalidateActivityParents(result.value);
  return { ok: true, activity: result.value };
}

export async function listActivityRevisionsAction(
  activityId: string,
  page = 1,
): Promise<ActivityRevisionResult> {
  await requireOwner();
  const parsed = z.object({
    activityId: z.uuid(),
    page: z.number().int().positive(),
  }).safeParse({ activityId, page });
  if (!parsed.success) {
    return {
      ok: false,
      error: "This activity could not be found. Refresh and try again.",
    };
  }

  const revisionPage = await (await activityService()).listRevisions(
    parsed.data.activityId,
    parsed.data.page,
  );
  return { ok: true, ...revisionPage };
}
