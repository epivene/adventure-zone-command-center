import Link from "next/link";
import { notFound } from "next/navigation";

import { updateBookingAction } from "@/app/(private)/bookings/actions";
import { BookingForm } from "@/components/bookings/booking-form";
import { DrizzleBookingRepository } from "@/features/bookings/booking-repository";
import { requireOwner } from "@/lib/auth/require-owner";

export const dynamic = "force-dynamic";

async function loadBooking(bookingId: string) {
  await requireOwner();
  const { db } = await import("@/db/client");
  return new DrizzleBookingRepository(db).getBookingDetail(bookingId);
}

export default async function EditBookingPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;
  const detail = await loadBooking(bookingId);
  if (!detail) notFound();

  const updateAction = updateBookingAction.bind(null, bookingId);

  return (
    <div className="mx-auto grid max-w-2xl gap-6">
      <header>
        <Link
          className="text-sm font-semibold text-slate-600 hover:text-orange-700"
          href={`/bookings/${bookingId}`}
        >
          ← Back to booking
        </Link>
        <p className="mt-6 text-sm font-bold uppercase tracking-[0.16em] text-orange-700">
          Booking details
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">
          Edit {detail.booking.name}
        </h1>
        <p className="mt-2 text-slate-600">
          Update the core event information without changing its follow-up plan.
        </p>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <BookingForm
          initialValues={{
            name: detail.booking.name,
            city: detail.booking.city,
            region: detail.booking.region,
            probability: detail.booking.probability,
          }}
          onSubmit={updateAction}
          variant="edit"
        />
      </section>
    </div>
  );
}
