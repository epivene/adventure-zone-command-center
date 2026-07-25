"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  bookingEditInputSchema,
  bookingInputSchema,
  type BookingEditInput,
  type BookingFormInput,
} from "@/features/bookings/booking-input";
import { DrizzleBookingRepository } from "@/features/bookings/booking-repository";
import {
  BookingService,
  type CompleteFollowUpInput,
} from "@/features/bookings/booking-service";
import { followUpCompletionInputSchema } from "@/features/bookings/follow-up-completion-input";
import { requireOwner } from "@/lib/auth/require-owner";
import { err } from "@/lib/result";

async function createBookingService() {
  const { db } = await import("@/db/client");
  return new BookingService(new DrizzleBookingRepository(db));
}

export type BookingActionResult =
  | { ok: true }
  | { ok: false; error: string };

export async function createBookingAction(
  input: BookingFormInput,
): Promise<BookingActionResult> {
  await requireOwner();
  const parsed = bookingInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Review the highlighted booking fields." };
  }

  const service = await createBookingService();
  try {
    await service.createBooking({
      name: parsed.data.name,
      city: parsed.data.city,
      region: parsed.data.region,
      status: parsed.data.status,
      probability: parsed.data.probability,
      nextAction:
        parsed.data.nextActionKind && parsed.data.nextActionDueAt
          ? {
              kind: parsed.data.nextActionKind,
              dueAt: parsed.data.nextActionDueAt,
            }
          : null,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_ACTION_REQUIRED") {
      return {
        ok: false,
        error: "Choose a future next-action date for this active lead.",
      };
    }
    throw error;
  }

  revalidatePath("/bookings");
  redirect("/bookings");
}

export async function updateBookingAction(
  bookingId: string,
  input: BookingEditInput,
): Promise<BookingActionResult> {
  await requireOwner();
  const parsed = bookingEditInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Review the highlighted booking fields." };
  }

  const { db } = await import("@/db/client");
  const updated = await new DrizzleBookingRepository(db).updateBookingDetails(
    bookingId,
    parsed.data,
  );
  if (!updated) return { ok: false, error: "This booking could not be found." };

  revalidatePath("/bookings");
  revalidatePath(`/bookings/${bookingId}`);
  redirect(`/bookings/${bookingId}`);
}

export async function completeFollowUpAction(input: CompleteFollowUpInput) {
  await requireOwner();
  const parsed = followUpCompletionInputSchema.safeParse(input);
  if (!parsed.success) {
    return err({ code: "INVALID_COMPLETION_INPUT" as const });
  }

  const service = await createBookingService();
  const result = await service.completeFollowUp(parsed.data);

  if (result.ok) {
    revalidatePath("/bookings");
    revalidatePath(`/bookings/${result.value.bookingId}`);
  }

  return result;
}
