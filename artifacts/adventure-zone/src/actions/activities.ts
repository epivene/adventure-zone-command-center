import { apiDelete, apiGet, apiPost } from "@/lib/auth-token";
import { toast } from "@workspace/avz-crm/hooks/use-toast";
import type {
  ActivityParent,
  CreateActivityInput,
  EditActivityInput,
  ActivityTimelineItem,
} from "@/features/activities/activity-types";
import type {
  ActivityMutationResult,
  ActivityRevisionResult,
  ActivityTimelinePageResult,
} from "@/components/activities/activity-timeline";

type SerializedActivityTimelineItem = Omit<
  ActivityTimelineItem,
  "occurredAt" | "createdAt" | "updatedAt"
> & {
  occurredAt: string | Date;
  createdAt: string | Date;
  updatedAt: string | Date;
};

type SerializedActivityTimelinePageResult =
  | {
      ok: true;
      items: SerializedActivityTimelineItem[];
      nextPage: number | null;
    }
  | { ok: false; error: string };

type SerializedActivityMutationResult =
  | { ok: true; activity: SerializedActivityTimelineItem }
  | { ok: false; error: string };

function coerceActivityTimelineItem(
  item: SerializedActivityTimelineItem,
): ActivityTimelineItem {
  return {
    ...item,
    occurredAt: new Date(item.occurredAt),
    createdAt: new Date(item.createdAt),
    updatedAt: new Date(item.updatedAt),
  };
}

export async function loadTimelinePageAction(
  parent: ActivityParent,
  page: number,
): Promise<ActivityTimelinePageResult> {
  try {
    const qs = new URLSearchParams();
    if (parent.contactId) qs.set("contactId", parent.contactId);
    if (parent.organizationId) qs.set("organizationId", parent.organizationId);
    if (parent.bookingId) qs.set("bookingId", parent.bookingId);
    qs.set("page", String(page));
    const result = await apiGet<SerializedActivityTimelinePageResult>(`/activities/timeline?${qs.toString()}`);
    if (!result.ok) return result;
    return {
      ...result,
      items: result.items.map(coerceActivityTimelineItem),
    };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function createActivityAction(
  input: CreateActivityInput,
): Promise<ActivityMutationResult> {
  try {
    const result = await apiPost<SerializedActivityMutationResult>("/activities", input);
    if (!result.ok) return result;
    const activity = coerceActivityTimelineItem(result.activity);
    if (input.kind === "note") toast({ title: "Note saved" });
    return { ...result, activity };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function editActivityAction(
  input: EditActivityInput,
): Promise<ActivityMutationResult> {
  try {
    const result = await apiPost<SerializedActivityMutationResult>("/activities/edit", input);
    if (!result.ok) return result;
    return { ...result, activity: coerceActivityTimelineItem(result.activity) };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function deleteActivityAction(
  activityId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    return await apiDelete<{ ok: boolean; error?: string }>(`/activities/${activityId}`);
  } catch (e: any) {
    return { ok: false, error: e.message ?? "Could not delete activity." };
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
