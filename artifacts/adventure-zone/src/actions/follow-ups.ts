import { apiDelete, apiFetch, apiPatch } from "@/lib/auth-token";
import type {
  EditFollowUpInput,
  FollowUpMutationResult,
  FollowUpRecord,
} from "@/features/follow-ups/follow-up-types";

type SerializedFollowUpRecord = Omit<FollowUpRecord, "dueAt" | "completedAt"> & {
  dueAt: string | Date;
  completedAt: string | Date | null;
};

type SerializedFollowUpMutationResult =
  | { ok: true; followUp: SerializedFollowUpRecord }
  | { ok: false; error: string };

function coerceFollowUpRecord(record: SerializedFollowUpRecord): FollowUpRecord {
  return {
    ...record,
    dueAt: new Date(record.dueAt),
    completedAt: record.completedAt ? new Date(record.completedAt) : null,
  };
}

export async function editFollowUpAction(
  input: EditFollowUpInput,
): Promise<FollowUpMutationResult> {
  try {
    const result = await apiPatch<SerializedFollowUpMutationResult>(
      `/follow-ups/${input.followUpId}`,
      input,
    );
    if (!result.ok) return result;
    return { ok: true, followUp: coerceFollowUpRecord(result.followUp) };
  } catch (error: any) {
    return { ok: false, error: error.message ?? "Could not update follow-up." };
  }
}

export async function deleteFollowUpAction(
  followUpId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await apiDelete<{ ok: true }>(`/follow-ups/${followUpId}`);
    return { ok: true };
  } catch (error: any) {
    return { ok: false, error: error.message ?? "Could not delete follow-up." };
  }
}
