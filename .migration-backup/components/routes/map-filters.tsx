"use client";

import { bookingStatusValues } from "@/features/bookings/booking-types";
import type { MapFilters } from "@/features/routes/map-data";
import type { TravelLeg } from "@/features/routes/travel-leg-repository";

function formatLabel(value: string) {
  return value
    .split("_")
    .map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`)
    .join(" ");
}

export function MapFiltersPanel({
  filters,
  onChange,
  onReset,
  regions,
  travelLegs,
}: {
  filters: MapFilters;
  onChange: (filters: MapFilters) => void;
  onReset: () => void;
  regions: string[];
  travelLegs: TravelLeg[];
}) {
  return (
    <section
      aria-label="Map filters"
      className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 xl:grid-cols-5"
    >
      <label className="grid gap-1 text-sm font-semibold">
        Booking status
        <select
          onChange={(event) =>
            onChange({
              ...filters,
              statuses: event.target.value
                ? [event.target.value as MapFilters["statuses"][number]]
                : [],
            })
          }
          value={filters.statuses[0] ?? ""}
        >
          <option value="">All statuses</option>
          {bookingStatusValues.map((status) => (
            <option key={status} value={status}>
              {formatLabel(status)}
            </option>
          ))}
        </select>
      </label>

      <label className="grid gap-1 text-sm font-semibold">
        Travel leg
        <select
          onChange={(event) =>
            onChange({
              ...filters,
              travelLegIds: event.target.value ? [event.target.value] : [],
            })
          }
          value={filters.travelLegIds[0] ?? ""}
        >
          <option value="">All travel legs</option>
          {travelLegs.map((leg) => (
            <option key={leg.id} value={leg.id}>
              {leg.name}
            </option>
          ))}
        </select>
      </label>

      <label className="grid gap-1 text-sm font-semibold">
        State
        <select
          onChange={(event) =>
            onChange({
              ...filters,
              regions: event.target.value ? [event.target.value] : [],
            })
          }
          value={filters.regions[0] ?? ""}
        >
          <option value="">All states</option>
          {regions.map((region) => (
            <option key={region} value={region}>
              {region}
            </option>
          ))}
        </select>
      </label>

      <label className="grid gap-1 text-sm font-semibold">
        Starts after
        <input
          onChange={(event) =>
            onChange({ ...filters, dateFrom: event.target.value || null })
          }
          type="date"
          value={filters.dateFrom ?? ""}
        />
      </label>

      <label className="grid gap-1 text-sm font-semibold">
        Starts before
        <input
          onChange={(event) =>
            onChange({ ...filters, dateTo: event.target.value || null })
          }
          type="date"
          value={filters.dateTo ?? ""}
        />
      </label>

      <div className="flex items-end sm:col-span-2 xl:col-span-5">
        <button className="button-secondary" onClick={onReset} type="button">
          Reset filters
        </button>
      </div>
    </section>
  );
}
