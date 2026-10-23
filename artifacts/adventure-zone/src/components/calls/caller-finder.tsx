"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";

import { apiGet } from "@/lib/auth-token";

type CallerMatchReason =
  | "Exact phone"
  | "Exact email"
  | "Name"
  | "Organization or event"
  | "Due today"
  | "Recently contacted"
  | "Location"
  | "Route leg"
  | "Phone number"
  | "Same area code"
  | "Note text";

type CallerSuggestion = {
  contactId: string;
  name: string;
  organizationName: string | null;
  city: string | null;
  region: string | null;
  bookingStatus: string | null;
  routeLegName: string | null;
  lastContactedAt: string | null;
  reasons: CallerMatchReason[];
  score: number;
  noteSnippet?: string;
};

type CallerFinderResult = {
  exact: { kind: "one"; contactId: string } | { kind: "none" };
  suggestions: CallerSuggestion[];
  canCreate: boolean;
};

function looksLikePhone(value: string) {
  return /^[+\d().\s-]+$/.test(value) && value.replace(/\D/g, "").length >= 7;
}

function finderPath(value: string) {
  const query = new URLSearchParams();
  if (looksLikePhone(value)) query.set("phone", value);
  else if (value) query.set("q", value);
  return `/calls/caller-finder${query.size ? `?${query.toString()}` : ""}`;
}

function formatLastContacted(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(date);
}

function displayStatus(value: string) {
  return value.replaceAll("_", " ");
}

export function CallerFinder({
  initialPhone = "",
  onSelect,
}: {
  initialPhone?: string;
  onSelect: (contactId: string) => void;
}) {
  const [query, setQuery] = useState(initialPhone);
  const [result, setResult] = useState<CallerFinderResult | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const selectedExactId = useRef<string | null>(null);
  const mounted = useRef(true);
  const queryRef = useRef(query);
  const onSelectRef = useRef(onSelect);
  const searchState = useRef({
    inFlight: false,
    queuedQuery: null as string | null,
  });

  queryRef.current = query;
  onSelectRef.current = onSelect;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      searchState.current.queuedQuery = null;
    };
  }, []);

  const runLatestSearch = useCallback(async (nextQuery: string) => {
    const state = searchState.current;
    state.queuedQuery = nextQuery;
    if (state.inFlight) return;

    state.inFlight = true;
    while (state.queuedQuery !== null && mounted.current) {
      const requestedQuery = state.queuedQuery;
      state.queuedQuery = null;
      setIsLoading(true);
      setError("");

      try {
        const nextResult = await apiGet<CallerFinderResult>(
          finderPath(requestedQuery),
        );
        if (!mounted.current || queryRef.current.trim() !== requestedQuery) {
          continue;
        }
        setResult(nextResult);
        if (
          nextResult.exact.kind === "one" &&
          selectedExactId.current !== nextResult.exact.contactId
        ) {
          selectedExactId.current = nextResult.exact.contactId;
          onSelectRef.current(nextResult.exact.contactId);
        }
      } catch {
        if (mounted.current && queryRef.current.trim() === requestedQuery) {
          setError("Caller search is unavailable. Try again.");
        }
      }
    }

    state.inFlight = false;
    if (mounted.current) setIsLoading(false);
  }, []);

  useEffect(() => {
    searchState.current.queuedQuery = null;
    const timer = window.setTimeout(() => {
      void runLatestSearch(query.trim());
    }, 250);

    return () => {
      window.clearTimeout(timer);
    };
  }, [query, runLatestSearch]);

  const createQuery = new URLSearchParams({ mode: "add" });
  if (query.trim()) {
    createQuery.set(looksLikePhone(query.trim()) ? "phone" : "q", query.trim());
  }
  const createHref = `/calls/workspace?${createQuery.toString()}`;

  return (
    <section aria-labelledby="caller-finder-title" className="grid gap-5">
      <div>
        <h1 className="text-2xl font-bold" id="caller-finder-title">Find a caller</h1>
        <p className="mt-1 text-sm text-slate-600">
          Search phone, name, organization or event, email, location, route leg, status, or notes.
        </p>
      </div>
      <label className="grid gap-1.5 font-medium">
        Find caller
        <input
          autoComplete="off"
          onChange={(event) => {
            setResult(null);
            setQuery(event.target.value);
          }}
          placeholder="Phone, person, event, location, or note"
          type="search"
          value={query}
        />
      </label>
      {isLoading ? <p className="text-sm text-slate-500" role="status">Searching…</p> : null}
      {error ? <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800" role="alert">{error}</p> : null}
      {result?.suggestions.length ? (
        <div className="grid gap-3">
          <h2 className="text-xl font-bold">Possible callers</h2>
          <ul className="grid gap-3">
            {result.suggestions.map((suggestion) => {
              const location = [suggestion.city, suggestion.region].filter(Boolean).join(", ");
              const lastContacted = formatLastContacted(suggestion.lastContactedAt);
              return (
                <li key={suggestion.contactId}>
                  <button
                    className="grid w-full gap-2 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-orange-300 hover:bg-orange-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600"
                    onClick={() => onSelect(suggestion.contactId)}
                    type="button"
                  >
                    <span className="font-bold">
                      {suggestion.name}{suggestion.organizationName ? ` — ${suggestion.organizationName}` : ""}
                    </span>
                    <span className="flex flex-wrap gap-2 text-xs font-semibold text-slate-700">
                      {suggestion.reasons.map((reason) => (
                        <span className="rounded-full bg-slate-100 px-2 py-1" key={reason}>{reason}</span>
                      ))}
                    </span>
                    {location ? <span className="text-sm text-slate-600">{location}</span> : null}
                    {suggestion.bookingStatus || suggestion.routeLegName ? (
                      <span className="text-sm text-slate-600">
                        {[suggestion.bookingStatus ? displayStatus(suggestion.bookingStatus) : null, suggestion.routeLegName]
                          .filter(Boolean).join(" · ")}
                      </span>
                    ) : null}
                    {lastContacted ? <span className="text-sm text-slate-600">Last contacted {lastContacted}</span> : null}
                    {suggestion.noteSnippet ? <span className="text-sm italic text-slate-600">{suggestion.noteSnippet}</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : result && !isLoading ? <p className="text-sm text-slate-600">No possible callers found.</p> : null}
      {result?.canCreate ? <Link className="button-primary w-fit" href={createHref}>Create contact</Link> : null}
    </section>
  );
}
