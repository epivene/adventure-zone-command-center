import { apiPost, apiGet } from "@/lib/auth-token";
import type {
  EventProfileCreationInput,
} from "@/components/event-profiles/event-profile-form";

export async function loadEventProfileAction(profileId: string) {
  try {
    return await apiGet<any>(`/event-profiles/${profileId}/seed`);
  } catch {
    return null;
  }
}

export async function createEventProfileAction(
  input: EventProfileCreationInput,
): Promise<{ ok: true; profileId: string } | { ok: false; error: string }> {
  try {
    return await apiPost<any>("/event-profiles", input);
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}
