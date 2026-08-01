import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation } from "wouter";

import { apiGet } from "@/lib/auth-token";
import { createTripAction } from "@/actions/trips";
import type { TravelLeg } from "@/features/routes/travel-leg-repository";

export type TripListItem = {
  id: string;
  name: string;
  travelLegId: string;
  legName: string;
  legColor: string;
  startDate: string;
  endDate: string;
  stopCount: number;
  vehicleName: string | null;
  routeConfirmedAt: string | null;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(
    new Date(value),
  );
}

export function TripsSection({ travelLegs }: { travelLegs: TravelLeg[] }) {
  const [, setLocation] = useLocation();
  const [trips, setTrips] = useState<TripListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const activeLegs = travelLegs.filter((leg) => !leg.archivedAt);
  const [legId, setLegId] = useState("");
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  useEffect(() => {
    apiGet<{ trips: TripListItem[] }>("/trips")
      .then((data) => setTrips(data.trips))
      .catch((e) => setError(e.message));
  }, []);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const result = await createTripAction({
      travelLegId: legId || activeLegs[0]?.id || "",
      name,
      startDate: new Date(`${startDate}T12:00:00`).toISOString(),
      endDate: new Date(`${endDate || startDate}T12:00:00`).toISOString(),
    });
    setSubmitting(false);
    if (result.ok) {
      setLocation(`/trips/${result.tripId}`);
    } else {
      setError(result.error);
    }
  }

  return (
    <section aria-labelledby="trips-title" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold" id="trips-title">Trips</h2>
          <p className="mt-1 text-sm text-slate-600">
            Dated routes with ordered stops, drive times, and fuel estimates.
          </p>
        </div>
        <button
          className="button-primary"
          onClick={() => setShowForm((value) => !value)}
          type="button"
        >
          {showForm ? "Cancel" : "New trip"}
        </button>
      </div>

      {showForm ? (
        <form className="mt-4 grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-4" onSubmit={handleCreate}>
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            Travel leg
            <select
              className="rounded-lg border border-slate-300 px-3 py-2 font-normal"
              onChange={(event) => setLegId(event.target.value)}
              required
              value={legId || activeLegs[0]?.id || ""}
            >
              {activeLegs.map((leg) => (
                <option key={leg.id} value={leg.id}>{leg.name}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            Trip name
            <input
              className="rounded-lg border border-slate-300 px-3 py-2 font-normal"
              onChange={(event) => setName(event.target.value)}
              placeholder="August southern run"
              required
              value={name}
            />
          </label>
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            Start date
            <input
              className="rounded-lg border border-slate-300 px-3 py-2 font-normal"
              onChange={(event) => setStartDate(event.target.value)}
              required
              type="date"
              value={startDate}
            />
          </label>
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            End date
            <input
              className="rounded-lg border border-slate-300 px-3 py-2 font-normal"
              min={startDate}
              onChange={(event) => setEndDate(event.target.value)}
              type="date"
              value={endDate}
            />
          </label>
          <p className="text-xs text-slate-500 sm:col-span-2 lg:col-span-3">
            The trip starts and ends at the leg's base. You can change either on the trip page.
          </p>
          <button className="button-primary lg:justify-self-end" disabled={submitting} type="submit">
            {submitting ? "Creating…" : "Create trip"}
          </button>
        </form>
      ) : null}

      {error ? <p className="mt-3 text-sm font-medium text-rose-700">{error}</p> : null}

      {trips === null ? (
        <p className="mt-4 text-sm text-slate-500">Loading trips…</p>
      ) : trips.length === 0 ? (
        <p className="mt-4 text-sm text-slate-600">No trips planned yet.</p>
      ) : (
        <ul className="mt-4 grid gap-2">
          {trips.map((trip) => (
            <li className="rounded-lg border border-slate-200 p-3" key={trip.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="size-3 rounded-full"
                    style={{ backgroundColor: trip.legColor }}
                  />
                  <Link className="font-bold text-slate-950 hover:text-orange-700" href={`/trips/${trip.id}`}>
                    {trip.name}
                  </Link>
                  <span className="text-sm text-slate-600">· {trip.legName}</span>
                  {trip.routeConfirmedAt ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">
                      Route confirmed
                    </span>
                  ) : null}
                </div>
                <p className="text-sm text-slate-600">
                  {formatDate(trip.startDate)} – {formatDate(trip.endDate)} · {trip.stopCount}{" "}
                  {trip.stopCount === 1 ? "stop" : "stops"}
                  {trip.vehicleName ? ` · ${trip.vehicleName}` : ""}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
