import { OperationalCalendarProfileResults, type CalendarProfileResult } from "./operational-calendar-profile-results";
import { useRef, useState } from "react";
import { searchOperationalCalendarBookings, type OperationalCalendarCandidate } from "@/features/google-workspace/operational-calendar-client";

export function OperationalCalendarBookingSearch({ disabled, selectedBookingId, onSelect }: {
  disabled: boolean;
  selectedBookingId: string;
  onSelect: (bookingId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [profiles, setProfiles] = useState<CalendarProfileResult[]>([]);
  const [results, setResults] = useState<OperationalCalendarCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  async function search() {
    const version = ++request.current;
    setLoading(true);
    setError(null);
    setResults([]);
    setProfiles([]);
    setSearched(false);
    onSelect("");
    try {
      const response = await searchOperationalCalendarBookings(query);
      if (version !== request.current) return;
      setResults(response.candidates);
      setProfiles((response.profiles ?? []).filter(profile => !response.candidates.some(candidate => candidate.profileId === profile.profileId)));
      setSearched(true);
    } catch {
      if (version === request.current) setError("Could not search profiles. Try again.");
    } finally {
      if (version === request.current) setLoading(false);
    }
  }

  return <div className="mt-4 grid gap-2">
    <form className="flex flex-wrap items-end gap-2" onSubmit={event => {
      event.preventDefault();
      if (!disabled && query.trim().length >= 2) void search();
    }}>
      <label className="grid flex-1 gap-1 text-sm font-semibold">
        Search existing profiles and bookings
        <input type="search" maxLength={160} value={query} disabled={disabled}
          placeholder="Profile, event name, or city"
          onChange={event => {
            ++request.current;
            setQuery(event.target.value);
            setResults([]);
    setProfiles([]);
            setSearched(false);
            setLoading(false);
            setError(null);
            onSelect("");
          }} />
      </label>
      <button type="submit" className="button-secondary" disabled={disabled || loading || query.trim().length < 2}>
        {loading ? "Searching…" : "Search profiles"}
      </button>
    </form>
    <p className="text-xs text-slate-600">Searches all seasons and booking statuses. Select the correct booking year before linking.</p>
    {error ? <p role="alert">{error}</p> : null}
    {searched && !results.length && !profiles.length ? <p role="status">No bookings found. Try a shorter name or city. If the profile has no booking yet, open Profiles and add a booking to that existing profile.</p> : null}
    {results.length ? <fieldset className="grid gap-2">
      <legend className="text-sm font-bold">Existing bookings</legend>
      {results.map(candidate => <label key={candidate.bookingId} className="flex gap-3 rounded-lg border p-3">
        <input type="radio" disabled={disabled} checked={selectedBookingId === candidate.bookingId}
          onChange={() => onSelect(candidate.bookingId)} />
        <span>
          <span className="block font-semibold">{candidate.profileName ?? candidate.bookingName}</span>
          <span className="block text-sm">{candidate.bookingName} · {[candidate.city, candidate.region].filter(Boolean).join(", ")}</span>
          <span className="block text-xs">{candidate.startsAt?.slice(0, 10) ?? "Dates not set"}{candidate.endsAt ? " – " + candidate.endsAt.slice(0, 10) : ""}{candidate.travelLegName ? " · " + candidate.travelLegName : ""}</span>
        </span>
      </label>)}
    </fieldset> : null}
    <OperationalCalendarProfileResults profiles={profiles} />
    {results.length === 50 ? <p>Showing the first 50 bookings. Narrow the search to find yours.</p> : null}
  </div>;
}

