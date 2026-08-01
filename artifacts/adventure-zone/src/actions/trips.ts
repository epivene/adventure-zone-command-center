import { apiDelete, apiPatch, apiPost } from "@/lib/auth-token";

export type ActionResult = { ok: true } | { ok: false; error: string };

type ApiResponse = { ok: boolean; error?: string; code?: string };

async function run(action: () => Promise<ApiResponse>): Promise<ActionResult> {
  try {
    const response = await action();
    if (response.ok) return { ok: true };
    return { ok: false, error: response.error ?? "The request failed." };
  } catch (error: any) {
    return { ok: false, error: error?.message ?? "The request failed." };
  }
}

export type CreateTripInput = {
  travelLegId: string;
  name: string;
  startDate: string;
  endDate: string;
  start?: { label: string; latitude: number | null; longitude: number | null };
  end?: { label: string; latitude: number | null; longitude: number | null };
};

export async function createTripAction(
  input: CreateTripInput,
): Promise<{ ok: true; tripId: string } | { ok: false; error: string }> {
  try {
    const response = await apiPost<ApiResponse & { trip?: { id: string } }>(
      "/trips",
      input,
    );
    if (response.ok && response.trip) return { ok: true, tripId: response.trip.id };
    return { ok: false, error: response.error ?? "Could not create the trip." };
  } catch (error: any) {
    return { ok: false, error: error?.message ?? "Could not create the trip." };
  }
}

export type UpdateTripInput = Partial<{
  name: string;
  startDate: string;
  endDate: string;
  startLabel: string;
  startLatitude: number | null;
  startLongitude: number | null;
  endLabel: string;
  endLatitude: number | null;
  endLongitude: number | null;
  vehicleName: string | null;
  mpg: number | null;
  fuelPricePerGallon: number | null;
  notes: string | null;
}>;

export function updateTripAction(tripId: string, input: UpdateTripInput) {
  return run(() => apiPatch<ApiResponse>(`/trips/${tripId}`, input));
}

export function deleteTripAction(tripId: string) {
  return run(() => apiDelete<ApiResponse>(`/trips/${tripId}`));
}

export function addTripStopAction(tripId: string, bookingId: string) {
  return run(() => apiPost<ApiResponse>(`/trips/${tripId}/stops`, { bookingId }));
}

export function removeTripStopAction(tripId: string, stopId: string) {
  return run(() => apiDelete<ApiResponse>(`/trips/${tripId}/stops/${stopId}`));
}

export function reorderTripStopsAction(tripId: string, orderedStopIds: string[]) {
  return run(() => apiPost<ApiResponse>(`/trips/${tripId}/reorder`, { orderedStopIds }));
}

export async function applySuggestedOrderAction(
  tripId: string,
  force: boolean,
): Promise<ActionResult | { ok: false; error: string; code: "ROUTE_CONFIRMED" }> {
  try {
    const response = await apiPost<ApiResponse>(`/trips/${tripId}/suggest-order`, { force });
    if (response.ok) return { ok: true };
    if (response.code === "ROUTE_CONFIRMED") {
      return { ok: false, error: response.error ?? "Route is confirmed.", code: "ROUTE_CONFIRMED" };
    }
    return { ok: false, error: response.error ?? "Could not apply the suggested order." };
  } catch (error: any) {
    if (error?.body?.code === "ROUTE_CONFIRMED" || /confirmed/i.test(error?.message ?? "")) {
      return { ok: false, error: error?.message ?? "Route is confirmed.", code: "ROUTE_CONFIRMED" };
    }
    return { ok: false, error: error?.message ?? "Could not apply the suggested order." };
  }
}

export function refreshTripEstimatesAction(tripId: string) {
  return run(() => apiPost<ApiResponse>(`/trips/${tripId}/refresh`, {}));
}

export function overrideTripSegmentAction(
  tripId: string,
  segmentId: string,
  override: { overrideMiles: number | null; overrideMinutes: number | null },
) {
  return run(() =>
    apiPatch<ApiResponse>(`/trips/${tripId}/segments/${segmentId}`, override),
  );
}

export function addTripResourceAction(tripId: string, resourceId: string) {
  return run(() => apiPost<ApiResponse>(`/trips/${tripId}/resources`, { resourceId }));
}

export function removeTripResourceAction(tripId: string, resourceId: string) {
  return run(() => apiDelete<ApiResponse>(`/trips/${tripId}/resources/${resourceId}`));
}
