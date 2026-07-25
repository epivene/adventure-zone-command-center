import Link from "next/link";

import { createBookingAction } from "@/app/(private)/bookings/actions";
import { BookingForm } from "@/components/bookings/booking-form";

export default function NewBookingPage() {
  return (
    <div className="mx-auto grid max-w-2xl gap-6">
      <header>
        <Link
          className="text-sm font-semibold text-slate-600 hover:text-orange-700"
          href="/bookings"
        >
          ← Back to bookings
        </Link>
        <p className="mt-6 text-sm font-bold uppercase tracking-[0.16em] text-orange-700">
          Quick Add
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Add a lead</h1>
        <p className="mt-2 text-slate-600">
          Capture the essentials now. Every active lead needs a dated next action.
        </p>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <BookingForm draftKey="booking:new" onSubmit={createBookingAction} />
      </section>
    </div>
  );
}
