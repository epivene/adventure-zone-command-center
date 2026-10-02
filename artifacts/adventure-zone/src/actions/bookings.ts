import { apiPost, apiPatch } from "@/lib/auth-token";
import { notifyBookingOperationsChanged } from '@/features/bookings/booking-operations-changes';
import type { BookingFormInput, BookingEditInput } from "@/features/bookings/booking-input";
import type { CompleteFollowUpInput } from "@/features/bookings/booking-service";
import type { ConfigureBookingPackagesInput } from "@/features/packages/package-input";

export type BookingActionResult = { ok: true } | { ok: false; error: string };

export async function createBookingAction(
  input: BookingFormInput,
): Promise<BookingActionResult & { bookingId?: string }> {
  try {
    const res = await apiPost<{ ok: boolean; bookingId?: string; error?: string }>(
      "/bookings",
      input,
    );
    if (res.ok) return { ok: true, bookingId: res.bookingId };
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
    if (res.ok) { notifyBookingOperationsChanged(bookingId); return { ok: true }; }
    return { ok: false, error: res.error ?? "Could not update booking." };
  } catch (e: any) {
    return { ok: false, error: e.message ?? "Could not update booking." };
  }
}

export async function completeFollowUpAction(input: CompleteFollowUpInput) {
  try {
    return await apiPost<any>("/bookings/complete-follow-up", input);
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function configureBookingPackagesAction(
  input: ConfigureBookingPackagesInput,
): Promise<BookingActionResult> {
  try {
    const result = await apiPost<BookingActionResult>("/bookings/configure-packages", input);
    if (result.ok) notifyBookingOperationsChanged(input.bookingId);
    return result;
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function configureBookingResourcesAction(input: {
  bookingId: string;
  resourceIds: string[];
}) {
  try {
    const result = await apiPost<BookingActionResult>("/bookings/configure-resources", input);
    if (result.ok) notifyBookingOperationsChanged(input.bookingId);
    return result;
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
    const result = await apiPost<BookingActionResult>("/bookings/acknowledge-conflict", input);
    if (result.ok) notifyBookingOperationsChanged(input.bookingId);
    return result;
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
    const result = await apiPost<BookingActionResult>("/bookings/add-special-request", input);
    if (result.ok) notifyBookingOperationsChanged(input.bookingId);
    return result;
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function decideSpecialRequestAction(input: {
  specialRequestId: string;
  decision: "approved" | "declined";
  reason: string;
}) {
  try {
    const result = await apiPost<BookingActionResult>("/bookings/decide-special-request", input);
    if (result.ok) notifyBookingOperationsChanged('*');
    return result;
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}
