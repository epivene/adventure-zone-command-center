import { useEffect, useMemo, useState } from "react";

import {
  listPaperNoteEventFamilies,
  searchPaperNoteProfiles,
} from "@/features/paper-notes/paper-note-client";
import type {
  PaperNoteMatch,
  PaperNoteReviewDraft,
} from "@/features/paper-notes/paper-note-review-types";

type EventFamilyOption = { id: string; name: string; memberCount: number };

function matchKey(match: PaperNoteMatch) {
  return `${match.organizationId}:${match.organizationLocationId ?? "profile"}`;
}

export function PaperNoteDestinationPicker({
  review,
  matches,
  onChooseExisting,
  onChooseNewLocation,
  onChooseNewProfile,
  onNewLocationChange,
  onNewProfileFamilyChange,
  onRememberMatch,
}: {
  review: PaperNoteReviewDraft;
  matches: PaperNoteMatch[];
  onChooseExisting(match: PaperNoteMatch): void;
  onChooseNewLocation(match: PaperNoteMatch): void;
  onChooseNewProfile(): void;
  onNewLocationChange(patch: Partial<Extract<NonNullable<PaperNoteReviewDraft["destination"]>, { mode: "existing_profile_new_location" }>["newLocation"]>): void;
  onNewProfileFamilyChange(familyId: string | null): void;
  onRememberMatch(match: PaperNoteMatch): void;
}) {
  const destination = review.destination;
  const [query, setQuery] = useState("");
  const [manualMatches, setManualMatches] = useState<PaperNoteMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [families, setFamilies] = useState<EventFamilyOption[]>([]);
  const [familiesLoaded, setFamiliesLoaded] = useState(false);
  const [showChooser, setShowChooser] = useState(destination?.mode !== "existing_profile");

  useEffect(() => {
    if (destination?.mode !== "new_profile" || familiesLoaded) return;
    let cancelled = false;
    void listPaperNoteEventFamilies()
      .then((result) => {
        if (!cancelled) setFamilies(result);
      })
      .catch(() => {
        if (!cancelled) setFamilies([]);
      })
      .finally(() => {
        if (!cancelled) setFamiliesLoaded(true);
      });
    return () => { cancelled = true; };
  }, [destination?.mode, familiesLoaded]);

  useEffect(() => {
    if (destination?.mode === "existing_profile") setShowChooser(false);
    else setShowChooser(true);
  }, [
    destination?.mode,
    destination?.mode === "existing_profile" ? destination.organizationId : null,
    destination?.mode === "existing_profile" ? destination.organizationLocationId : null,
  ]);

  const manualOnlyMatches = useMemo(() => {
    const suggestedKeys = new Set(matches.map(matchKey));
    const deduped = new Map<string, PaperNoteMatch>();
    for (const match of manualMatches) {
      const key = matchKey(match);
      if (!suggestedKeys.has(key) && !deduped.has(key)) deduped.set(key, match);
    }
    return [...deduped.values()];
  }, [matches, manualMatches]);

  const selectedExistingMatch = useMemo(() => {
    if (destination?.mode !== "existing_profile") return null;
    return [...matches, ...manualMatches].find((match) =>
      match.organizationId === destination.organizationId
      && match.organizationLocationId === destination.organizationLocationId) ?? null;
  }, [destination, manualMatches, matches]);

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

  function matchCard(match: PaperNoteMatch) {
    return (
      <div
        className="rounded-xl border border-slate-200 p-3"
        key={matchKey(match)}
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
    );
  }

  return (
    <section className="mt-6 border-t border-slate-200 pt-5">
      <h3 className="font-bold text-slate-900">Where this entry belongs</h3>
      <p className="mt-1 text-sm text-slate-600">The app suggests matches from the paper details and can auto-link a clear, strong match.</p>

      {destination?.mode === "existing_profile" && !showChooser ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <div>
            <p className="text-sm font-bold text-emerald-950">Matched to existing profile</p>
            <p className="mt-1 text-sm text-emerald-900">
              {selectedExistingMatch?.name ?? "Existing CRM profile"}
              {selectedExistingMatch
                ? ` · ${[selectedExistingMatch.city, selectedExistingMatch.region].filter(Boolean).join(", ")}`
                : ""}
            </p>
            {selectedExistingMatch?.reasons.length ? (
              <p className="mt-1 text-xs text-emerald-800">{selectedExistingMatch.reasons.join(" · ")}</p>
            ) : null}
          </div>
          <button
            aria-label="Change matched profile"
            className="min-h-11 rounded-lg border border-emerald-300 bg-white px-3 py-2 text-sm font-bold text-emerald-900"
            onClick={() => setShowChooser(true)}
            type="button"
          >
            Change
          </button>
        </div>
      ) : null}

      {showChooser ? (
        <>
          {matches.length ? (
            <div className="mt-3">
              <h4 className="text-sm font-bold text-slate-900">Suggested matches</h4>
              <p className="mt-1 text-xs text-slate-500">Based on matching event/profile name, city/state, contact, phone, email, or venue.</p>
              <div className="mt-2 grid gap-2">
                {matches.map(matchCard)}
              </div>
            </div>
          ) : (
            <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
              No automatic match yet. Search existing profiles below before creating a new one.
            </p>
          )}

          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
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
              <p className="mt-2 text-xs text-slate-500">No search has run yet, or no additional profiles were found.</p>
            ) : null}
          </div>

          {manualOnlyMatches.length ? (
            <div className="mt-3">
              <h4 className="text-sm font-bold text-slate-900">Search results</h4>
              <div className="mt-2 grid gap-2">
                {manualOnlyMatches.map(matchCard)}
              </div>
            </div>
          ) : null}

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
        </>
      ) : null}

      {destination?.mode === "new_profile" ? (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            Event family (optional)
            <select
              aria-label="Event family (optional)"
              className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal"
              value={destination.eventFamilyId ?? ""}
              onChange={(event) => onNewProfileFamilyChange(event.target.value || null)}
            >
              <option value="">No event family</option>
              {families.map((family) => (
                <option key={family.id} value={family.id}>
                  {family.name} · {family.memberCount} profile{family.memberCount === 1 ? "" : "s"}
                </option>
              ))}
            </select>
          </label>
          {!familiesLoaded ? <p className="mt-1 text-xs text-slate-500">Loading event families…</p> : null}
        </div>
      ) : null}

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
