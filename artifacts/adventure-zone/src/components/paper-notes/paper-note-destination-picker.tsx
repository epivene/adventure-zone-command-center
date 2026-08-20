import { useMemo, useState } from "react";

import { searchPaperNoteProfiles } from "@/features/paper-notes/paper-note-client";
import type {
  PaperNoteMatch,
  PaperNoteReviewDraft,
} from "@/features/paper-notes/paper-note-review-types";

export function PaperNoteDestinationPicker({
  review,
  matches,
  onChooseExisting,
  onChooseNewLocation,
  onChooseNewProfile,
  onNewLocationChange,
  onRememberMatch,
}: {
  review: PaperNoteReviewDraft;
  matches: PaperNoteMatch[];
  onChooseExisting(match: PaperNoteMatch): void;
  onChooseNewLocation(match: PaperNoteMatch): void;
  onChooseNewProfile(): void;
  onNewLocationChange(patch: Partial<Extract<NonNullable<PaperNoteReviewDraft["destination"]>, { mode: "existing_profile_new_location" }>["newLocation"]>): void;
  onRememberMatch(match: PaperNoteMatch): void;
}) {
  const destination = review.destination;
  const [query, setQuery] = useState("");
  const [manualMatches, setManualMatches] = useState<PaperNoteMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

  const visibleMatches = useMemo(() => {
    const deduped = new Map<string, PaperNoteMatch>();
    for (const match of [...matches, ...manualMatches]) {
      const key = `${match.organizationId}:${match.organizationLocationId ?? "profile"}`;
      if (!deduped.has(key)) deduped.set(key, match);
    }
    return [...deduped.values()];
  }, [matches, manualMatches]);

  async function runSearch() {
    const trimmed = query.trim();
    if (!trimmed || searching) return;
    setSearching(true);
    setSearchError("");
    try {
      setManualMatches(await searchPaperNoteProfiles(trimmed));
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "Could not search profiles.");
    } finally {
      setSearching(false);
    }
  }

  function chooseExisting(match: PaperNoteMatch) {
    onRememberMatch(match);
    onChooseExisting(match);
  }

  function chooseNewLocation(match: PaperNoteMatch) {
    onRememberMatch(match);
    onChooseNewLocation(match);
  }

  return (
    <section className="mt-6 border-t border-slate-200 pt-5">
      <h3 className="font-bold text-slate-900">Where this entry belongs</h3>
      <p className="mt-1 text-sm text-slate-600">Suggestions are evidence only. You choose the destination.</p>

      <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <label className="grid gap-1 text-sm font-semibold text-slate-700">
          Search existing profiles
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              aria-label="Search existing profiles"
              className="min-h-11 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal"
              placeholder="Event name, city, contact, phone, email…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void runSearch();
                }
              }}
            />
            <button
              aria-label="Search profiles"
              className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-800 disabled:opacity-50"
              disabled={!query.trim() || searching}
              onClick={() => void runSearch()}
              type="button"
            >
              {searching ? "Searching…" : "Search"}
            </button>
          </div>
        </label>
        {searchError ? <p className="mt-2 text-sm text-rose-800" role="alert">{searchError}</p> : null}
        {!searching && query.trim() && manualMatches.length === 0 && !searchError ? (
          <p className="mt-2 text-xs text-slate-500">Search to look beyond the suggested matches.</p>
        ) : null}
      </div>

      <div className="mt-3 grid gap-2">
        {visibleMatches.map((match) => (
          <div
            className="rounded-xl border border-slate-200 p-3"
            key={`${match.organizationId}:${match.organizationLocationId ?? "profile"}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-bold text-slate-900">{match.name}</p>
                <p className="text-sm text-slate-500">
                  {[match.city, match.region].filter(Boolean).join(", ") || "Location not saved"}
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {match.reasons.map((reason) => (
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700" key={reason}>
                      {reason}
                    </span>
                  ))}
                </div>
                {match.contacts.length ? (
                  <p className="mt-2 text-xs text-slate-500">
                    {match.contacts.length} saved contact{match.contacts.length === 1 ? "" : "s"} available to link
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  aria-label={`Use ${match.name}`}
                  className="min-h-11 rounded-lg border border-orange-300 bg-orange-50 px-3 py-2 text-sm font-bold text-orange-900"
                  onClick={() => chooseExisting(match)}
                  type="button"
                >
                  Use this profile
                </button>
                <button
                  aria-label={`Create new location under ${match.name}`}
                  className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-800"
                  onClick={() => chooseNewLocation(match)}
                  type="button"
                >
                  New location here
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          aria-label="Create new profile"
          className="min-h-11 rounded-lg bg-slate-900 px-3 py-2 text-sm font-bold text-white"
          onClick={onChooseNewProfile}
          type="button"
        >
          Create new profile
        </button>
      </div>

      {destination?.mode === "existing_profile_new_location" ? (
        <div className="mt-4 grid gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-bold text-emerald-950">New location under existing profile</p>
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            New location label
            <input
              aria-label="New location label"
              className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal"
              value={destination.newLocation.label}
              onChange={(event) => onNewLocationChange({ label: event.target.value })}
            />
          </label>
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            Venue name
            <input
              className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal"
              value={destination.newLocation.venueName ?? ""}
              onChange={(event) => onNewLocationChange({ venueName: event.target.value || null })}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm font-semibold text-slate-700">
              New location city
              <input
                aria-label="New location city"
                className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal"
                value={destination.newLocation.city ?? ""}
                onChange={(event) => onNewLocationChange({ city: event.target.value || null })}
              />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-slate-700">
              New location state
              <input
                aria-label="New location state"
                className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal uppercase"
                maxLength={2}
                value={destination.newLocation.region ?? ""}
                onChange={(event) => onNewLocationChange({ region: event.target.value.toUpperCase() || null })}
              />
            </label>
          </div>
        </div>
      ) : null}
    </section>
  );
}
