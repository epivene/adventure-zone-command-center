import { useEffect, useState } from "react";
import { Link, Redirect, useSearch } from "wouter";
import { apiGet } from "@/lib/auth-token";

type ContractAttentionBooking = {
  id: string;
  name: string;
  city?: string | null;
  region?: string | null;
  status: string;
  startsAt?: string | Date | null;
};

export function isContractAttentionBooking(booking: Pick<ContractAttentionBooking, "status">) {
  return booking.status === "pending_contract" || booking.status === "contract_received";
}

function statusLabel(status: string) {
  return status === "contract_received" ? "Contract received" : "Pending contract";
}

export default function BookingsPage() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const showContractAttention = params.get("attention") === "contracts";
  const [bookings, setBookings] = useState<ContractAttentionBooking[]>([]);
  const [loading, setLoading] = useState(showContractAttention);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!showContractAttention) return;
    setLoading(true);
    setError(null);
    apiGet<{ bookings: ContractAttentionBooking[] }>("/bookings")
      .then((result) => setBookings((result.bookings ?? []).filter(isContractAttentionBooking)))
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load contract work."))
      .finally(() => setLoading(false));
  }, [showContractAttention]);

  if (!showContractAttention) return <Redirect to="/profiles" />;

  return (
    <div className="mx-auto grid max-w-5xl gap-5 pb-8">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-5">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">Booking work</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Contracts needing attention</h1>
          <p className="mt-2 text-sm text-slate-600">Only pending contracts and received contracts are shown here, matching the count on Today.</p>
        </div>
        <Link className="text-sm font-bold text-orange-700 hover:underline" href="/today">Back to Today</Link>
      </header>

      {loading ? <p className="text-sm text-slate-500">Loading contract work…</p> : null}
      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700" role="alert">{error}</div> : null}

      {!loading && !error && bookings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6">
          <p className="font-semibold text-slate-900">No contracts need attention right now.</p>
          <p className="mt-1 text-sm text-slate-600">When a booking moves to Pending contract or Contract received, it will appear here.</p>
        </div>
      ) : null}

      {!loading && !error && bookings.length ? (
        <div className="grid gap-3">
          {bookings.map((booking) => (
            <Link
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-orange-300"
              href={`/bookings/${booking.id}`}
              key={booking.id}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-bold text-slate-950">{booking.name}</h2>
                  <p className="mt-1 text-sm text-slate-600">{[booking.city, booking.region].filter(Boolean).join(", ") || "Location not set"}</p>
                  {booking.startsAt ? <p className="mt-1 text-xs font-semibold text-slate-500">{new Date(booking.startsAt).toLocaleDateString()}</p> : null}
                </div>
                <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-bold text-orange-900">{statusLabel(booking.status)}</span>
              </div>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
