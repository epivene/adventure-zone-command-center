import { apiPost, apiPatch, apiFetch } from "@/lib/auth-token";
import type { BookingFormInput, BookingEditInput } from "@/features/bookings/booking-input";
import type { CompleteFollowUpInput } from "@/features/bookings/booking-service";

export type BookingActionResult = { ok: true } | { ok: false; error: string };

export async function createBookingAction(
  input: BookingFormInput,
): Promise<BookingActionResult & { bookingId?: string }> {
  try {
    const res = await apiPost<{ ok: boolean; bookingId?: string; error?: string }>(
      "/bookings",
      input,
    );
    if (res.ok) {
      return { ok: true, bookingId: res.bookingId };
    }
    return { ok: false, error: res.error ?? "Could not create booking." };
  } catch (e: any) {
    return { ok: false, error: e.message ?? "Could not create booking." };
  }
}

export async function updateBookingAction(
  bookingId: string,
  input: BookingEditInput,
): Promise<BookingActionResult> {
  try {
    const res = await apiPatch<{ ok: boolean; error?: string }>(
      `/bookings/${bookingId}`,
      input,
    );
    if (res.ok) {
      return { ok: true };
    }
    return { ok: false, error: res.error ?? "Could not update booking." };
  } catch (e: any) {
    return { ok: false, error: e.message ?? "Could not update booking." };
  }
}

export async function completeFollowUpAction(input: CompleteFollowUpInput) {
  try {
    const res = await apiPost<any>("/bookings/complete-follow-up", input);
    return res;
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function configureBookingPackagesAction(input: {
  bookingId: string;
  packageTemplateIds: string[];
  physicalAttractionTotal: number | null;
  attractionTotalApprovalReason: string | null;
  resourceAttributions: Record<string, string[]>;
  specialRequestDecisions: Array<{ id: string; status: string; reason: string | null }>;
}) {
  try {
    return await apiPost<BookingActionResult>("/bookings/configure-packages", input);
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function configureBookingResourcesAction(input: {
  bookingId: string;
  resourceIds: string[];
}) {
  try {
    return await apiPost<BookingActionResult>("/bookings/configure-resources", input);
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function acknowledgeResourceConflictAction(input: {
  bookingId: string;
  conflictKey: string;
  reason: string;
}) {
  try {
    return await apiPost<BookingActionResult>("/bookings/acknowledge-conflict", input);
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function addSpecialRequestAction(input: {
  bookingId: string;
  description: string;
  treatment: string;
}) {
  try {
    return await apiPost<BookingActionResult>("/bookings/add-special-request", input);
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function decideSpecialRequestAction(input: {
  bookingId: string;
  requestId: string;
  status: string;
  reason: string | null;
}) {
  try {
    return await apiPost<BookingActionResult>("/bookings/decide-special-request", input);
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}
