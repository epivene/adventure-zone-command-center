import Link from "next/link";

import { BookingList } from "@/components/bookings/booking-list";
import { DrizzleBookingRepository } from "@/features/bookings/booking-repository";
import { requireOwner } from "@/lib/auth/require-owner";

export const dynamic = "force-dynamic";

async function loadBookings() {
  await requireOwner();
  const { db } = await import("@/db/client");
  return new DrizzleBookingRepository(db).listBookings();
}

export default async function BookingsPage() {
  const bookings = await loadBookings();

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">
            Pipeline
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Bookings</h1>
          <p className="mt-2 max-w-2xl text-slate-600">
            Keep every opportunity visible, with its next action and travel context.
          </p>
        </div>
        <Link className="button-primary text-center" href="/bookings/new">
          Add lead
        </Link>
      </header>

      <BookingList bookings={bookings} />
    </div>
  );
}
