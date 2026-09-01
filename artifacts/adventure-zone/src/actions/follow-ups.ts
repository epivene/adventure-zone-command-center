import { apiFetch, apiPatch, apiPost } from "@/lib/auth-token";
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


export async function createFollowUpAction(input: {
  organizationId: string;
  contactId?: string | null;
  bookingId?: string | null;
  kind: string;
  dueAt: Date;
}): Promise<FollowUpMutationResult> {
  try {
    const result = await apiPost<SerializedFollowUpMutationResult>("/follow-ups", input);
    if (!result.ok) return result;
    return { ok: true, followUp: coerceFollowUpRecord(result.followUp) };
  } catch (error: any) {
    return { ok: false, error: error.message ?? "Could not create follow-up." };
  }
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
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const response = await apiFetch(`/follow-ups/${followUpId}`, {
      method: "DELETE",
    });
    const result = (await response.json()) as
      | { ok: true }
      | { ok: false; error?: string };
    if (!response.ok || !result.ok) {
      return {
        ok: false,
        error:
          !result.ok && result.error
            ? result.error
            : `API ${response.status}`,
      };
    }
    return result;
  } catch (error: any) {
    return { ok: false, error: error.message ?? "Could not delete follow-up." };
  }
}
