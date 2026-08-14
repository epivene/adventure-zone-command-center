/**
 * "Possible Locations" section for an organization / event-profile page.
 * Fetches organization_locations records and the authoritative rollup,
 * renders collapsible cards, and provides Add / Edit / Remove actions.
 */
import { useCallback, useEffect, useState } from "react";

import { apiGet } from "@/lib/auth-token";
import { LocationCard, type LocationSummary } from "./location-card";
import { LocationForm, type LocationFormInitial } from "./location-form";

// ─── Types ────────────────────────────────────────────────────────────────────

type LocationRollup = {
  locationCount: number;
  upcomingBookingCount: number;
  overdueFollowUpCount: number;
  mostRecentActivityAt: string | null;
  travelLegs: Array<{ id: string; name: string; color: string }>;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function fmtDate(value: string | null | undefined): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "America/Denver",
  }).format(new Date(value));
}

// ─── Main component ───────────────────────────────────────────────────────────

export function PossibleLocationsSection({ orgId }: { orgId: string }) {
  const [locations, setLocations] = useState<LocationSummary[]>([]);
  const [rollup, setRollup] = useState<LocationRollup | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Form state: undefined = closed, null = add-new, LocationFormInitial = edit
  const [formState, setFormState] = useState<
    undefined | null | LocationFormInitial
  >(undefined);

  // Tracks how many times each location has been successfully edited.
  // Cards watch their version to know when to invalidate cached detail.
  const [detailVersions, setDetailVersions] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const [locData, rollupData] = await Promise.all([
        apiGet<{ locations: LocationSummary[] }>(`/organizations/${orgId}/locations`),
        apiGet<{ rollup: LocationRollup }>(`/organizations/${orgId}/locations/rollup`),
      ]);
      setLocations(locData.locations ?? []);
      setRollup(rollupData.rollup);
    } catch (err) {
      setFetchError(
        err instanceof Error ? err.message : "Failed to load locations.",
      );
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => { void load(); }, [load]);

  function handleRemoved(id: string) {
    setLocations((prev) => prev.filter((l) => l.id !== id));
    // Refresh rollup after removal so counts stay accurate.
    void load();
  }

  function handleFormSuccess() {
    // If this was an edit (formState has an id), bump the version for that
    // card so it discards its cached detail and re-fetches on next expand.
    if (formState !== null && formState !== undefined && "id" in formState) {
      const editedId = formState.id;
      setDetailVersions((prev) => ({
        ...prev,
        [editedId]: (prev[editedId] ?? 0) + 1,
      }));
    }
    setFormState(undefined);
    void load();
  }

  return (
    <>
      <section
        className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
        aria-labelledby="possible-locations-title"
      >
        {/* ── Section header ───────────────────────────────────────────── */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-xl font-bold" id="possible-locations-title">
              Possible Locations
            </h2>
            {!loading && !fetchError && rollup && (
              <p className="mt-1 text-sm text-slate-600">
                {plural(rollup.locationCount, "location")}
                {rollup.upcomingBookingCount > 0
                  ? ` · ${plural(rollup.upcomingBookingCount, "upcoming booking")}`
                  : ""}
                {rollup.overdueFollowUpCount > 0 ? (
                  <span className="text-rose-700">
                    {" "}
                    · {plural(rollup.overdueFollowUpCount, "overdue follow-up")}
                  </span>
                ) : null}
                {rollup.mostRecentActivityAt ? (
                  <span> · Last activity {fmtDate(rollup.mostRecentActivityAt)}</span>
                ) : null}
              </p>
            )}
          </div>
          <button
            className="shrink-0 rounded-md bg-orange-600 px-3 py-2 text-sm font-semibold text-white hover:bg-orange-700"
            type="button"
            onClick={() => setFormState(null)}
          >
            + Add location
          </button>
        </div>

        {/* ── Loading / error / empty ──────────────────────────────────── */}
        {loading && (
          <p className="mt-4 text-sm text-slate-500">Loading locations…</p>
        )}
        {fetchError && (
          <p className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {fetchError}
          </p>
        )}

        {/* ── Location cards ───────────────────────────────────────────── */}
        {!loading && !fetchError && locations.length === 0 && (
          <p className="mt-4 text-sm text-slate-500">
            No possible locations have been added yet.
          </p>
        )}
        {!loading && locations.length > 0 && (
          <ul className="mt-4 grid gap-2">
            {locations.map((loc) => (
              <LocationCard
                key={loc.id}
                orgId={orgId}
                location={loc}
                detailVersion={detailVersions[loc.id] ?? 0}
                onEdit={(initial) => setFormState(initial)}
                onRemoved={handleRemoved}
              />
            ))}
          </ul>
        )}
      </section>

      {/* ── Add / Edit modal ─────────────────────────────────────────────── */}
      {formState !== undefined && (
        <LocationForm
          orgId={orgId}
          initial={formState ?? undefined}
          onClose={() => setFormState(undefined)}
          onSuccess={handleFormSuccess}
        />
      )}
    </>
  );
}
