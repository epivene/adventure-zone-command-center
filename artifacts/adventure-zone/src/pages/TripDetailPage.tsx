import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { apiGet } from "@/lib/auth-token";
import {
  addTripResourceAction,
  addTripStopAction,
  applySuggestedOrderAction,
  deleteTripAction,
  overrideTripSegmentAction,
  refreshTripEstimatesAction,
  removeTripResourceAction,
  removeTripStopAction,
  reorderTripStopsAction,
  updateTripAction,
} from "@/actions/trips";
import { EventMap } from "@/components/routes/event-map";

type TripStop = {
  id: string;
  bookingId: string;
  bookingName: string;
  city: string | null;
  region: string | null;
  latitude: number | null;
  longitude: number | null;
  startsAt: string | null;
  status: string;
  sortOrder: number;
};

type TripSegment = {
  id: string;
  sequence: number;
  fromLabel: string;
  toLabel: string;
  miles: number | null;
  minutes: number | null;
  source: "live" | "cached" | "manual" | null;
  overrideMiles: number | null;
  overrideMinutes: number | null;
  effectiveMiles: number | null;
  effectiveMinutes: number | null;
  effectiveSource: "live" | "cached" | "manual" | null;
  gallons: number | null;
  fuelCost: number | null;
};

type TripDetailResponse = {
  trip: {
    id: string;
    travelLegId: string;
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
    routeConfirmedAt: string | null;
    notes: string | null;
  };
  stops: TripStop[];
  segments: TripSegment[];
  totals: {
    miles: number;
    minutes: number;
    gallons: number | null;
    cost: number | null;
    incomplete: boolean;
  };
  resources: {
    assignmentId: string;
    resourceId: string;
    code: string;
    name: string;
    category: string;
    movable: boolean;
  }[];
};

const sourceStyles: Record<string, string> = {
  live: "bg-emerald-100 text-emerald-800",
  cached: "bg-amber-100 text-amber-800",
  manual: "bg-sky-100 text-sky-800",
};

function SourceBadge({ source }: { source: string | null }) {
  if (!source) {
    return (
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">
        No estimate
      </span>
    );
  }
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-bold capitalize ${sourceStyles[source] ?? "bg-slate-100 text-slate-700"}`}>
      {source}
    </span>
  );
}

function formatMinutes(minutes: number | null) {
  if (minutes === null) return "—";
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return hours > 0 ? `${hours}h ${rest}m` : `${rest}m`;
}

function formatMiles(miles: number | null) {
  return miles === null ? "—" : `${miles.toFixed(1)} mi`;
}

function formatMoney(value: number | null) {
  return value === null ? "—" : `$${value.toFixed(2)}`;
}

function SortableStop({
  stop,
  index,
  onRemove,
}: {
  stop: TripStop;
  index: number;
  onRemove: (stopId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: stop.id });
  return (
    <li
      className={`flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 ${isDragging ? "shadow-lg ring-2 ring-orange-300" : ""}`}
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button
        aria-label={`Drag to reorder ${stop.bookingName}`}
        className="cursor-grab touch-none rounded p-1 text-slate-400 hover:text-slate-700"
        type="button"
        {...attributes}
        {...listeners}
      >
        ⠿
      </button>
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-slate-900 text-xs font-bold text-white">
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <Link className="font-semibold text-slate-950 hover:text-orange-700" href={`/bookings/${stop.bookingId}`}>
          {stop.bookingName}
        </Link>
        <p className="text-xs text-slate-600">
          {[stop.city, stop.region].filter(Boolean).join(", ") || "No location"}
          {stop.startsAt
            ? ` · ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(stop.startsAt))}`
            : ""}
          {stop.latitude === null ? " · no coordinates" : ""}
        </p>
      </div>
      <button
        className="text-sm font-semibold text-rose-700 hover:underline"
        onClick={() => onRemove(stop.id)}
        type="button"
      >
        Remove
      </button>
    </li>
  );
}

export default function TripDetailPage() {
  const [, params] = useRoute("/trips/:tripId");
  const tripId = params?.tripId ?? "";
  const [data, setData] = useState<TripDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bookings, setBookings] = useState<any[] | null>(null);
  const [allResources, setAllResources] = useState<any[] | null>(null);
  const [addBookingId, setAddBookingId] = useState("");
  const [addResourceId, setAddResourceId] = useState("");
  const [snapshot, setSnapshot] = useState({ vehicleName: "", mpg: "", fuelPrice: "" });
  const [endpoints, setEndpoints] = useState({
    startLabel: "",
    startLat: "",
    startLng: "",
    endLabel: "",
    endLat: "",
    endLng: "",
  });
  const [overrideDrafts, setOverrideDrafts] = useState<Record<string, { miles: string; minutes: string }>>({});
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const load = useCallback(async () => {
    try {
      const detail = await apiGet<TripDetailResponse>(`/trips/${tripId}`);
      setData(detail);
      setSnapshot({
        vehicleName: detail.trip.vehicleName ?? "",
        mpg: detail.trip.mpg !== null ? String(detail.trip.mpg) : "",
        fuelPrice:
          detail.trip.fuelPricePerGallon !== null
            ? String(detail.trip.fuelPricePerGallon)
            : "",
      });
      setEndpoints({
        startLabel: detail.trip.startLabel,
        startLat: detail.trip.startLatitude !== null ? String(detail.trip.startLatitude) : "",
        startLng: detail.trip.startLongitude !== null ? String(detail.trip.startLongitude) : "",
        endLabel: detail.trip.endLabel,
        endLat: detail.trip.endLatitude !== null ? String(detail.trip.endLatitude) : "",
        endLng: detail.trip.endLongitude !== null ? String(detail.trip.endLongitude) : "",
      });
      setOverrideDrafts(
        Object.fromEntries(
          detail.segments.map((segment) => [
            segment.id,
            {
              miles: segment.overrideMiles !== null ? String(segment.overrideMiles) : "",
              minutes: segment.overrideMinutes !== null ? String(segment.overrideMinutes) : "",
            },
          ]),
        ),
      );
    } catch (e: any) {
      setError(e.message);
    }
  }, [tripId]);

  useEffect(() => {
    load();
    apiGet<{ bookings: any[] }>("/bookings")
      .then((response) => setBookings(response.bookings))
      .catch(() => setBookings([]));
    apiGet<{ resources: any[] }>("/settings/packages-resources")
      .then((response) => setAllResources(response.resources))
      .catch(() => setAllResources([]));
  }, [load]);

  async function runAction(action: () => Promise<{ ok: boolean; error?: string }>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await action();
    if (!result.ok) setError(result.error ?? "The request failed.");
    await load();
    setBusy(false);
  }

  async function handleDragEnd(event: DragEndEvent) {
    if (!data || !event.over || event.active.id === event.over.id) return;
    const ids = data.stops.map((stop) => stop.id);
    const reordered = arrayMove(
      ids,
      ids.indexOf(String(event.active.id)),
      ids.indexOf(String(event.over.id)),
    );
    // Optimistic reorder for smooth UI, then persist (this confirms the route).
    setData({
      ...data,
      stops: reordered.map(
        (id, index) => ({ ...data.stops.find((stop) => stop.id === id)!, sortOrder: index + 1 }),
      ),
    });
    await runAction(() => reorderTripStopsAction(tripId, reordered));
    setNotice("Stop order saved — this route is now confirmed and won't be rearranged automatically.");
  }

  async function handleSuggest() {
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await applySuggestedOrderAction(tripId, false);
    if (!result.ok && "code" in result && result.code === "ROUTE_CONFIRMED") {
      const confirmed = window.confirm(
        "This route is confirmed and won't be rearranged automatically. Replace it with the suggested order?",
      );
      if (confirmed) {
        const forced = await applySuggestedOrderAction(tripId, true);
        if (!forced.ok) setError(forced.error);
      }
    } else if (!result.ok) {
      setError(result.error);
    }
    await load();
    setBusy(false);
  }

  const stopEvents = useMemo(() => {
    if (!data) return [];
    return data.stops
      .filter((stop) => stop.latitude !== null && stop.longitude !== null)
      .map((stop) => ({
        id: stop.bookingId,
        name: `${stop.sortOrder}. ${stop.bookingName}`,
        city: stop.city,
        region: stop.region,
        latitude: stop.latitude,
        longitude: stop.longitude,
        startsAt: stop.startsAt ? new Date(stop.startsAt) : null,
        endsAt: null,
        status: stop.status,
        travelLegId: data.trip.travelLegId,
      }));
  }, [data]);

  if (error && !data) {
    return (
      <div className="mx-auto max-w-4xl">
        <p className="text-rose-700">{error}</p>
        <Link className="text-orange-700 hover:underline" href="/routes">← Back to Routes</Link>
      </div>
    );
  }
  if (!data) return <p className="text-slate-500">Loading trip…</p>;

  const { trip, stops, segments, totals, resources } = data;
  const stopBookingIds = new Set(stops.map((stop) => stop.bookingId));
  const assignedResourceIds = new Set(resources.map((resource) => resource.resourceId));
  const availableBookings = (bookings ?? []).filter((booking) => !stopBookingIds.has(booking.id));
  const availableResources = (allResources ?? []).filter(
    (resource) => !assignedResourceIds.has(resource.id),
  );

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <header>
        <Link className="text-sm font-semibold text-orange-700 hover:underline" href="/routes">
          ← Routes
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">{trip.name}</h1>
          {trip.routeConfirmedAt ? (
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-bold text-emerald-800">
              Route confirmed
            </span>
          ) : (
            <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-bold text-slate-600">
              Suggested order
            </span>
          )}
        </div>
        <p className="mt-1 text-slate-600">
          {new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(trip.startDate))}
          {" – "}
          {new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(trip.endDate))}
        </p>
      </header>

      {error ? <p className="rounded-lg bg-rose-50 p-3 text-sm font-medium text-rose-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-emerald-50 p-3 text-sm font-medium text-emerald-800">{notice}</p> : null}

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="grid content-start gap-6">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-bold">Stops</h2>
              <div className="flex gap-2">
                <button className="button-secondary" disabled={busy} onClick={handleSuggest} type="button">
                  Suggest order
                </button>
                <button
                  className="button-secondary"
                  disabled={busy}
                  onClick={() => runAction(() => refreshTripEstimatesAction(tripId))}
                  type="button"
                >
                  Refresh estimates
                </button>
              </div>
            </div>
            <p className="mt-1 text-sm text-slate-600">
              Drag stops to set your own order. Reordering confirms the route.
            </p>
            {stops.length === 0 ? (
              <p className="mt-4 text-sm text-slate-600">No stops yet — add a booking below.</p>
            ) : (
              <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd} sensors={sensors}>
                <SortableContext items={stops.map((stop) => stop.id)} strategy={verticalListSortingStrategy}>
                  <ul className="mt-4 grid gap-2">
                    {stops.map((stop, index) => (
                      <SortableStop
                        index={index}
                        key={stop.id}
                        onRemove={(stopId) => runAction(() => removeTripStopAction(tripId, stopId))}
                        stop={stop}
                      />
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
            )}
            <form
              className="mt-4 flex flex-wrap items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (!addBookingId) return;
                runAction(() => addTripStopAction(tripId, addBookingId)).then(() => setAddBookingId(""));
              }}
            >
              <label className="grid min-w-64 flex-1 gap-1 text-sm font-semibold text-slate-700">
                Add booking stop
                <select
                  className="rounded-lg border border-slate-300 px-3 py-2 font-normal"
                  onChange={(event) => setAddBookingId(event.target.value)}
                  value={addBookingId}
                >
                  <option value="">Choose a booking…</option>
                  {availableBookings.map((booking) => (
                    <option key={booking.id} value={booking.id}>
                      {booking.name ?? booking.eventName ?? booking.id}
                      {booking.city ? ` — ${booking.city}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <button className="button-primary" disabled={busy || !addBookingId} type="submit">
                Add stop
              </button>
            </form>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-xl font-bold">Route segments</h2>
            <p className="mt-1 text-sm text-slate-600">
              Every estimate is labeled live, cached, or manual. Enter manual miles/minutes to
              override a segment.
            </p>
            {segments.length === 0 ? (
              <p className="mt-4 text-sm text-slate-600">Add stops to build the route.</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                      <th className="py-2 pr-3">Segment</th>
                      <th className="py-2 pr-3">Miles</th>
                      <th className="py-2 pr-3">Drive time</th>
                      <th className="py-2 pr-3">Gallons</th>
                      <th className="py-2 pr-3">Fuel cost</th>
                      <th className="py-2 pr-3">Source</th>
                      <th className="py-2">Manual override</th>
                    </tr>
                  </thead>
                  <tbody>
                    {segments.map((segment) => {
                      const draft = overrideDrafts[segment.id] ?? { miles: "", minutes: "" };
                      return (
                        <tr className="border-b border-slate-100 align-top" key={segment.id}>
                          <td className="py-2 pr-3">
                            <p className="font-semibold text-slate-900">{segment.fromLabel}</p>
                            <p className="text-slate-500">→ {segment.toLabel}</p>
                          </td>
                          <td className="py-2 pr-3">{formatMiles(segment.effectiveMiles)}</td>
                          <td className="py-2 pr-3">{formatMinutes(segment.effectiveMinutes)}</td>
                          <td className="py-2 pr-3">
                            {segment.gallons === null ? "—" : segment.gallons.toFixed(1)}
                          </td>
                          <td className="py-2 pr-3">{formatMoney(segment.fuelCost)}</td>
                          <td className="py-2 pr-3"><SourceBadge source={segment.effectiveSource} /></td>
                          <td className="py-2">
                            <form
                              className="flex flex-wrap items-center gap-1"
                              onSubmit={(event) => {
                                event.preventDefault();
                                runAction(() =>
                                  overrideTripSegmentAction(tripId, segment.id, {
                                    overrideMiles: draft.miles === "" ? null : Number(draft.miles),
                                    overrideMinutes: draft.minutes === "" ? null : Number(draft.minutes),
                                  }),
                                );
                              }}
                            >
                              <input
                                aria-label="Override miles"
                                className="w-20 rounded border border-slate-300 px-2 py-1"
                                min={0}
                                onChange={(event) =>
                                  setOverrideDrafts((drafts) => ({
                                    ...drafts,
                                    [segment.id]: { ...draft, miles: event.target.value },
                                  }))
                                }
                                placeholder="mi"
                                step="any"
                                type="number"
                                value={draft.miles}
                              />
                              <input
                                aria-label="Override minutes"
                                className="w-20 rounded border border-slate-300 px-2 py-1"
                                min={0}
                                onChange={(event) =>
                                  setOverrideDrafts((drafts) => ({
                                    ...drafts,
                                    [segment.id]: { ...draft, minutes: event.target.value },
                                  }))
                                }
                                placeholder="min"
                                step="any"
                                type="number"
                                value={draft.minutes}
                              />
                              <button className="button-secondary px-2 py-1 text-xs" disabled={busy} type="submit">
                                Save
                              </button>
                            </form>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="font-bold text-slate-900">
                      <td className="py-3 pr-3">Round trip</td>
                      <td className="py-3 pr-3">{formatMiles(totals.miles)}</td>
                      <td className="py-3 pr-3">{formatMinutes(totals.minutes)}</td>
                      <td className="py-3 pr-3">
                        {totals.gallons === null ? "—" : totals.gallons.toFixed(1)}
                      </td>
                      <td className="py-3 pr-3">{formatMoney(totals.cost)}</td>
                      <td className="py-3 pr-3" colSpan={2}>
                        {totals.incomplete ? (
                          <span className="text-xs font-semibold text-amber-700">
                            Some segments have no estimate — totals are partial.
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>

          {stopEvents.length > 0 ? (
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-xl font-bold">Trip map</h2>
              <div className="mt-3">
                <EventMap events={stopEvents as any} travelLegs={[]} />
              </div>
            </section>
          ) : null}
        </div>

        <div className="grid content-start gap-6">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-xl font-bold">Vehicle & fuel snapshot</h2>
            <p className="mt-1 text-sm text-slate-600">
              Saved with this trip — changing it never rewrites other trips or leg defaults.
            </p>
            <form
              className="mt-3 grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                runAction(() =>
                  updateTripAction(tripId, {
                    vehicleName: snapshot.vehicleName.trim() || null,
                    mpg: snapshot.mpg === "" ? null : Number(snapshot.mpg),
                    fuelPricePerGallon: snapshot.fuelPrice === "" ? null : Number(snapshot.fuelPrice),
                  }),
                );
              }}
            >
              <label className="grid gap-1 text-sm font-semibold text-slate-700">
                Vehicle
                <input
                  className="rounded-lg border border-slate-300 px-3 py-2 font-normal"
                  onChange={(event) => setSnapshot({ ...snapshot, vehicleName: event.target.value })}
                  value={snapshot.vehicleName}
                />
              </label>
              <label className="grid gap-1 text-sm font-semibold text-slate-700">
                MPG
                <input
                  className="rounded-lg border border-slate-300 px-3 py-2 font-normal"
                  min={0.1}
                  onChange={(event) => setSnapshot({ ...snapshot, mpg: event.target.value })}
                  step="any"
                  type="number"
                  value={snapshot.mpg}
                />
              </label>
              <label className="grid gap-1 text-sm font-semibold text-slate-700">
                Fuel price per gallon ($)
                <input
                  className="rounded-lg border border-slate-300 px-3 py-2 font-normal"
                  min={0}
                  onChange={(event) => setSnapshot({ ...snapshot, fuelPrice: event.target.value })}
                  step="any"
                  type="number"
                  value={snapshot.fuelPrice}
                />
              </label>
              <button className="button-primary" disabled={busy} type="submit">Save snapshot</button>
            </form>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-xl font-bold">Start & end</h2>
            <p className="mt-1 text-sm text-slate-600">
              Defaults to the leg's base. Coordinates enable road estimates.
            </p>
            <form
              className="mt-3 grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                runAction(() =>
                  updateTripAction(tripId, {
                    startLabel: endpoints.startLabel.trim() || trip.startLabel,
                    startLatitude: endpoints.startLat === "" ? null : Number(endpoints.startLat),
                    startLongitude: endpoints.startLng === "" ? null : Number(endpoints.startLng),
                    endLabel: endpoints.endLabel.trim() || trip.endLabel,
                    endLatitude: endpoints.endLat === "" ? null : Number(endpoints.endLat),
                    endLongitude: endpoints.endLng === "" ? null : Number(endpoints.endLng),
                  }),
                );
              }}
            >
              <label className="grid gap-1 text-sm font-semibold text-slate-700">
                Start label
                <input
                  className="rounded-lg border border-slate-300 px-3 py-2 font-normal"
                  onChange={(event) => setEndpoints({ ...endpoints, startLabel: event.target.value })}
                  value={endpoints.startLabel}
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  aria-label="Start latitude"
                  className="rounded-lg border border-slate-300 px-3 py-2"
                  onChange={(event) => setEndpoints({ ...endpoints, startLat: event.target.value })}
                  placeholder="Lat"
                  step="any"
                  type="number"
                  value={endpoints.startLat}
                />
                <input
                  aria-label="Start longitude"
                  className="rounded-lg border border-slate-300 px-3 py-2"
                  onChange={(event) => setEndpoints({ ...endpoints, startLng: event.target.value })}
                  placeholder="Lng"
                  step="any"
                  type="number"
                  value={endpoints.startLng}
                />
              </div>
              <label className="grid gap-1 text-sm font-semibold text-slate-700">
                End label
                <input
                  className="rounded-lg border border-slate-300 px-3 py-2 font-normal"
                  onChange={(event) => setEndpoints({ ...endpoints, endLabel: event.target.value })}
                  value={endpoints.endLabel}
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  aria-label="End latitude"
                  className="rounded-lg border border-slate-300 px-3 py-2"
                  onChange={(event) => setEndpoints({ ...endpoints, endLat: event.target.value })}
                  placeholder="Lat"
                  step="any"
                  type="number"
                  value={endpoints.endLat}
                />
                <input
                  aria-label="End longitude"
                  className="rounded-lg border border-slate-300 px-3 py-2"
                  onChange={(event) => setEndpoints({ ...endpoints, endLng: event.target.value })}
                  placeholder="Lng"
                  step="any"
                  type="number"
                  value={endpoints.endLng}
                />
              </div>
              <button className="button-primary" disabled={busy} type="submit">Save endpoints</button>
            </form>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-xl font-bold">Resources on this trip</h2>
            <p className="mt-1 text-sm text-slate-600">
              Assigned equipment (like the paintball trailer) is reserved for the trip's dates and
              feeds conflict warnings.
            </p>
            {resources.length === 0 ? (
              <p className="mt-3 text-sm text-slate-600">No resources assigned.</p>
            ) : (
              <ul className="mt-3 grid gap-2">
                {resources.map((resource) => (
                  <li className="flex items-center justify-between rounded-lg border border-slate-200 p-2 text-sm" key={resource.assignmentId}>
                    <span className="font-semibold">{resource.name}</span>
                    <button
                      className="font-semibold text-rose-700 hover:underline"
                      onClick={() => runAction(() => removeTripResourceAction(tripId, resource.resourceId))}
                      type="button"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form
              className="mt-3 flex items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (!addResourceId) return;
                runAction(() => addTripResourceAction(tripId, addResourceId)).then(() => setAddResourceId(""));
              }}
            >
              <select
                aria-label="Assign resource"
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                onChange={(event) => setAddResourceId(event.target.value)}
                value={addResourceId}
              >
                <option value="">Choose a resource…</option>
                {availableResources.map((resource) => (
                  <option key={resource.id} value={resource.id}>{resource.name}</option>
                ))}
              </select>
              <button className="button-secondary" disabled={busy || !addResourceId} type="submit">
                Assign
              </button>
            </form>
          </section>

          <section className="rounded-xl border border-rose-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold text-rose-800">Delete trip</h2>
            <button
              className="mt-2 rounded-lg border border-rose-300 px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50"
              onClick={() => {
                if (window.confirm("Delete this trip? Stops and estimates will be removed. Bookings are not affected.")) {
                  deleteTripAction(tripId).then((result) => {
                    if (result.ok) window.history.back();
                    else setError(result.error);
                  });
                }
              }}
              type="button"
            >
              Delete trip
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
