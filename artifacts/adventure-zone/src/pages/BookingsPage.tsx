import { useEffect, useState } from "react";
import { Link, useSearch } from "wouter";
import { apiGet } from "@/lib/auth-token";
import { BookingList } from "@/components/bookings/booking-list";
import type { BookingListItem } from "@/components/bookings/booking-list";
import { bookingStatusValues, type BookingStatus } from "@/features/bookings/booking-types";

export default function BookingsPage() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const requestedStatus = params.get("status");
  const initialStatus: BookingStatus | "" = bookingStatusValues.includes(requestedStatus as BookingStatus)
    ? requestedStatus as BookingStatus
    : "";
  const [bookings, setBookings] = useState<BookingListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const now = new Date();

  useEffect(() => {
    apiGet<any>("/bookings")
      .then((data) => {
        setBookings(
          (data.bookings ?? data ?? []).map((b: any) => ({
            ...b,
            startsAt: b.startsAt ? new Date(b.startsAt) : null,
            endsAt: b.endsAt ? new Date(b.endsAt) : null,
            nextAction: b.nextAction
              ? { ...b.nextAction, dueAt: new Date(b.nextAction.dueAt) }
              : null,
          })),
        );
        setLoading(false);
      })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

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
        <Link className="button-primary text-center" href="/quick-add">
          Add Event / Lead
        </Link>
      </header>

      {loading ? (
        <p className="text-slate-500">Loading bookings…</p>
      ) : error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
          <p className="text-rose-700">{error}</p>
        </div>
      ) : (
        <BookingList
          bookings={bookings}
          now={now}
          initialStatus={initialStatus}
          initialShowPast={initialStatus === "new_lead"}
        />
      )}
    </div>
  );
}
