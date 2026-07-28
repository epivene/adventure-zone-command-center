"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { ActivityRevisionResult } from "@/components/activities/activity-timeline";
import type { CompleteCallResult } from "@/components/calls/call-workspace";
import { ActivityService } from "@/features/activities/activity-service";
import { DrizzleActivityRepository } from "@/features/activities/activity-repository";
import { completeCallInputSchema } from "@/features/calls/call-input";
import { DrizzleCallRepository } from "@/features/calls/call-repository";
import { CallService } from "@/features/calls/call-service";
import type { CallError, CompleteCallInput } from "@/features/calls/call-types";
import { requireOwner } from "@/lib/auth/require-owner";

function readableCallError(error: CallError) {
  switch (error.code) {
    case "INVALID_CALL_INPUT": return error.message;
    case "ORGANIZATION_NOT_FOUND": return "This organization could not be found. Refresh and try again.";
    case "LAST_RESORT_REQUIRES_ORGANIZATION": return "Last Resort is only available when this call has an organization.";
    case "CONTACT_NOT_FOUND": return "This contact could not be found. Refresh and try again.";
    case "BOOKING_NOT_FOUND": return "This booking could not be found. Refresh and try again.";
    case "FOLLOW_UP_NOT_FOUND": return "This follow-up could not be found. Refresh and try again.";
    case "FOLLOW_UP_BOOKING_MISMATCH": return "This follow-up does not belong to the selected booking.";
    case "CONTACT_ORGANIZATION_MISMATCH": return "This contact does not belong to the selected organization.";
    case "BOOKING_ORGANIZATION_MISMATCH": return "This booking does not belong to the selected organization.";
    case "FOLLOW_UP_ORGANIZATION_MISMATCH": return "This follow-up does not belong to the selected organization.";
    case "FOLLOW_UP_CONTACT_MISMATCH": return "This follow-up does not belong to the selected contact.";
    case "ALREADY_COMPLETED": return "This follow-up was already completed. Refresh to see its saved outcome.";
    case "NEXT_ACTION_REQUIRED": return "Choose a next action and date before completing this call.";
    case "RESULTING_STATUS_MISMATCH": return "The selected disposition determines a different booking status.";
  }
}

export async function completeCallAction(input: CompleteCallInput): Promise<CompleteCallResult> {
  await requireOwner();
  const parsed = completeCallInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Review the call details." };
  }

  const { db } = await import("@/db/client");
  const result = await new CallService(new DrizzleCallRepository(db)).complete(parsed.data);
  if (!result.ok) return { ok: false, error: readableCallError(result.error) };

  revalidatePath("/today");
  revalidatePath("/contacts");
  revalidatePath("/bookings");
  revalidatePath("/organizations");
  if (parsed.data.contactId) revalidatePath(`/contacts/${parsed.data.contactId}`);
  if (parsed.data.bookingId) revalidatePath(`/bookings/${parsed.data.bookingId}`);
  if (parsed.data.organizationId) {
    revalidatePath(`/organizations/${parsed.data.organizationId}`);
  }
  return { ok: true };
}

export async function listActivityRevisionsAction(activityId: string): Promise<ActivityRevisionResult> {
  await requireOwner();
  if (!z.uuid().safeParse(activityId).success) {
    return { ok: false, error: "This activity could not be found. Refresh and try again." };
  }
  const { db } = await import("@/db/client");
  const revisions = await new ActivityService(
    new DrizzleActivityRepository(db),
  ).listRevisions(activityId);
  return { ok: true, revisions };
}
