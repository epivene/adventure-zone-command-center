import { apiDelete, apiPatch } from "@/lib/auth-token";

export type FollowUpUpdateInput = {
  kind: string;
  /** YYYY-MM-DD */
  dueAt: string;
};

export type FollowUpActionResult =
  | { ok: true; followUp?: { id: string; kind: string; dueAt: string } }
  | { ok: false; error: string };

export async function editFollowUpAction(
  followUpId: string,
  input: FollowUpUpdateInput,
): Promise<FollowUpActionResult> {
  try {
    return await apiPatch<FollowUpActionResult>(`/follow-ups/${followUpId}`, input);
  } catch (e: any) {
    return { ok: false, error: e.message ?? "Could not update follow-up." };
  }
}

export async function deleteFollowUpAction(
  followUpId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    return await apiDelete<{ ok: boolean; error?: string }>(`/follow-ups/${followUpId}`);
  } catch (e: any) {
    return { ok: false, error: e.message ?? "Could not delete follow-up." };
  }
}
