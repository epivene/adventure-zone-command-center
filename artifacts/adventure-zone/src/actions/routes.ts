import { apiPost, apiDelete } from "@/lib/auth-token";
import type {
  TravelLegConfiguration,
  TravelLegDetails,
  TravelLegOrder,
} from "@/features/routes/travel-leg-input";
import type { TravelLeg } from "@/features/routes/travel-leg-repository";

export type UpdateTravelLegsResult =
  | { ok: true }
  | { ok: false; error: string };

export type UpdateTravelLegResult =
  | { ok: true; leg: TravelLeg }
  | { ok: false; error: string };

export type ReorderTravelLegsResult =
  | { ok: true; legs: TravelLeg[] }
  | { ok: false; error: string };

export type AddTravelLegResult =
  | { ok: true; leg: TravelLeg }
  | { ok: false; error: string };

export type DeleteTravelLegResult =
  | { ok: true }
  | { ok: false; error: string };

export async function updateTravelLegAction(
  id: string,
  input: TravelLegDetails,
): Promise<UpdateTravelLegResult> {
  try {
    const res = await apiPost<{ ok: boolean; leg: TravelLeg; error?: string }>(
      `/routes/travel-legs/${id}/configure`,
      input,
    );
    if (res.ok) {
      return { ok: true, leg: res.leg };
    }
    return { ok: false, error: res.error ?? "Could not update travel leg." };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function reorderTravelLegsAction(
  input: TravelLegOrder,
): Promise<ReorderTravelLegsResult> {
  try {
    const res = await apiPost<{ ok: boolean; legs: TravelLeg[]; error?: string }>(
      "/routes/travel-legs/reorder",
      input,
    );
    if (res.ok) {
      return { ok: true, legs: res.legs };
    }
    return { ok: false, error: res.error ?? "Could not reorder travel legs." };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

// Legacy bulk action retained for compatibility with older callers.
export async function updateTravelLegsAction(
  input: TravelLegConfiguration,
): Promise<UpdateTravelLegsResult> {
  try {
    const res = await apiPost<{ ok: boolean; error?: string }>(
      "/routes/travel-legs/configure",
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

export async function addTravelLegAction(): Promise<AddTravelLegResult> {
  try {
    const leg = await apiPost<TravelLeg>("/routes/travel-legs", {});
    return { ok: true, leg };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export type ArchiveTravelLegResult =
  | { ok: true }
  | { ok: false; error: string };

export async function archiveTravelLegAction(
  id: string,
): Promise<ArchiveTravelLegResult> {
  try {
    await apiPost<{ ok: boolean }>(`/routes/travel-legs/${id}/archive`, {});
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function restoreTravelLegAction(
  id: string,
): Promise<ArchiveTravelLegResult> {
  try {
    await apiPost<{ ok: boolean }>(`/routes/travel-legs/${id}/restore`, {});
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function deleteTravelLegAction(
  id: string,
): Promise<DeleteTravelLegResult> {
  try {
    await apiDelete<{ ok: boolean }>(`/routes/travel-legs/${id}`);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}
