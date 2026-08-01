import { apiPost, apiPatch } from "@/lib/auth-token";
import type {
  CreateActivityInput,
  EditActivityInput,
  ActivityTimelineItem,
} from "@/features/activities/activity-types";
import type {
  ActivityMutationResult,
  ActivityRevisionResult,
} from "@/components/activities/activity-timeline";

export async function createActivityAction(
  input: CreateActivityInput,
): Promise<ActivityMutationResult> {
  try {
    return await apiPost<ActivityMutationResult>("/activities", input);
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function editActivityAction(
  input: EditActivityInput,
): Promise<ActivityMutationResult> {
  try {
    return await apiPost<ActivityMutationResult>("/activities/edit", input);
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function listActivityRevisionsAction(
  activityId: string,
): Promise<ActivityRevisionResult> {
  try {
    return await apiPost<ActivityRevisionResult>("/activities/revisions", { activityId });
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}
