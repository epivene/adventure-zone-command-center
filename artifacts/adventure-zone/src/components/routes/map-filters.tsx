"use client";

import type { MapFilters } from "@/features/routes/map-data";

export function MapFiltersPanel({
  filters,
  onChange,
  onReset,
  regions,
}: {
  filters: MapFilters;
  onChange: (filters: MapFilters) => void;
  onReset: () => void;
  regions: string[];
}) {
  return (
    <section
      aria-label="Additional map filters"
      className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-3"
    >
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
        Overlaps after
        <input
          onChange={(event) =>
            onChange({ ...filters, dateFrom: event.target.value || null })
          }
          type="date"
          value={filters.dateFrom ?? ""}
        />
      </label>

      <label className="grid gap-1 text-sm font-semibold">
        Overlaps before
        <input
          onChange={(event) =>
            onChange({ ...filters, dateTo: event.target.value || null })
          }
          type="date"
          value={filters.dateTo ?? ""}
        />
      </label>

      <div className="sm:col-span-3">
        <button className="button-secondary" onClick={onReset} type="button">
          Reset extra filters
        </button>
      </div>
    </section>
  );
}
