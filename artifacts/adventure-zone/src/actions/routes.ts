import { apiPost } from "@/lib/auth-token";
import type { TravelLegConfiguration } from "@/features/routes/travel-leg-input";

export type UpdateTravelLegsResult =
  | { ok: true }
  | { ok: false; error: string };

export async function updateTravelLegsAction(
  input: TravelLegConfiguration,
): Promise<UpdateTravelLegsResult> {
  try {
    const res = await apiPost<{ ok: boolean; error?: string }>(
      "/routes/travel-legs",
      input,
    );
    if (res.ok) {
      return { ok: true };
    }
    return { ok: false, error: res.error ?? "Could not update travel legs." };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}
