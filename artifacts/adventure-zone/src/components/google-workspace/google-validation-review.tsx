import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";

import {
  getGoogleWorkspaceValidationReview,
  ignoreGoogleWorkspaceValidationReview,
  resolveGoogleWorkspaceValidationReview,
  type GoogleValidationReviewItem,
} from "@/features/google-workspace/google-workspace-client";
import {
  searchGoogleReviewProfiles,
  type GoogleReviewProfileSearchResult,
} from "@/features/google-workspace/google-review-profile-search";

type SearchState = {
  query: string;
  results: GoogleReviewProfileSearchResult[];
  searching: boolean;
};

export function GoogleValidationReview({
  onPendingCountChange,
}: {
  onPendingCountChange?(count: number): void;
} = {}) {
  const [items, setItems] = useState<GoogleValidationReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyMessageId, setBusyMessageId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchByMessage, setSearchByMessage] = useState<Record<string, SearchState>>({});

  async function load() {
    setError(null);
    try {
      const result = await getGoogleWorkspaceValidationReview();
      setItems(result.items);
      onPendingCountChange?.(
        result.items.filter((item) => item.state === "pending").length,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load email review items.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const pending = useMemo(
    () => items.filter((item) => item.state === "pending"),
    [items],
  );
  const resolvedCount = items.filter((item) => item.state === "resolved").length;
  const ignoredCount = items.filter((item) => item.state === "ignored").length;

  async function assign(item: GoogleValidationReviewItem, organizationId: string) {
    setBusyMessageId(item.messageId);
    setError(null);
    try {
      await resolveGoogleWorkspaceValidationReview(item.messageId, organizationId);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not assign this email.");
    } finally {
      setBusyMessageId(null);
    }
  }

  async function ignore(item: GoogleValidationReviewItem) {
    setBusyMessageId(item.messageId);
    setError(null);
    try {
      await ignoreGoogleWorkspaceValidationReview(item.messageId);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not ignore this email.");
    } finally {
      setBusyMessageId(null);
    }
  }

  function updateQuery(messageId: string, query: string) {
    setSearchByMessage((current) => ({
      ...current,
      [messageId]: {
        query,
        results: current[messageId]?.results ?? [],
        searching: false,
      },
    }));
  }

  async function search(item: GoogleValidationReviewItem) {
    const current = searchByMessage[item.messageId] ?? {
      query: "",
      results: [],
      searching: false,
    };
    const query = current.query.trim();
    if (!query) return;
    setSearchByMessage((state) => ({
      ...state,
      [item.messageId]: { ...current, searching: true },
    }));
    try {
      const results = await searchGoogleReviewProfiles(query);
      setSearchByMessage((state) => ({
        ...state,
        [item.messageId]: { query, results, searching: false },
      }));
    } catch (caught) {
      setSearchByMessage((state) => ({
        ...state,
        [item.messageId]: { query, results: [], searching: false },
      }));
      setError(caught instanceof Error ? caught.message : "Could not search profiles.");
    }
  }

  if (loading) {
    return <p className="text-sm text-slate-500">Loading email review…</p>;
  }

  return (
    <section className="grid gap-4 rounded-xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900 dark:bg-amber-950/20">
      <div>
        <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
          Needs Review
        </h3>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Assign uncertain business email to the right profile, or ignore it if it does not belong in the CRM.
        </p>
        {resolvedCount || ignoredCount ? (
          <p className="mt-1 text-xs text-slate-500">
            {resolvedCount} resolved · {ignoredCount} ignored
          </p>
        ) : null}
      </div>

      {error ? <p className="text-sm font-semibold text-rose-700" role="alert">{error}</p> : null}

      {pending.length === 0 ? (
        <p className="rounded-lg bg-white p-3 text-sm text-slate-600 dark:bg-slate-950/40 dark:text-slate-300">
          No unresolved email in this validation sample.
        </p>
      ) : (
        <div className="grid gap-3">
          {pending.map((item) => {
            const searchState = searchByMessage[item.messageId] ?? {
              query: "",
              results: [],
              searching: false,
            };
            const busy = busyMessageId === item.messageId;
            return (
              <article className="rounded-xl border border-amber-200 bg-white p-4 shadow-sm dark:border-amber-900 dark:bg-slate-950/40" key={item.messageId}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="break-words font-semibold text-slate-900 dark:text-slate-100">
                      {item.subject || "(No subject)"}
                    </p>
                    <p className="mt-1 break-words text-xs text-slate-500">
                      {item.from || "Unknown sender"}
                    </p>
                  </div>
                  {item.hasAttachments ? (
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      Has attachment
                    </span>
                  ) : null}
                </div>

                {item.candidates.length > 0 ? (
                  <div className="mt-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                      Suggested profiles
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {item.candidates.map((candidate) => (
                        <button
                          aria-label={`Assign to ${candidate.name}`}
                          className="button-secondary px-3 py-1.5 text-sm"
                          disabled={busy}
                          key={candidate.id}
                          onClick={() => void assign(item, candidate.id)}
                          type="button"
                        >
                          {candidate.name}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
                  <label className="sr-only" htmlFor={`profile-search-${item.messageId}`}>
                    Search profiles for {item.subject || "email"}
                  </label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <input
                      aria-label={`Search profiles for ${item.subject || "email"}`}
                      className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                      id={`profile-search-${item.messageId}`}
                      onChange={(event) => updateQuery(item.messageId, event.target.value)}
                      placeholder="Search another profile"
                      value={searchState.query}
                    />
                  </div>
                  <button
                    className="button-secondary px-3 py-2"
                    disabled={busy || searchState.searching || !searchState.query.trim()}
                    onClick={() => void search(item)}
                    type="button"
                  >
                    {searchState.searching ? "Searching…" : "Search profiles"}
                  </button>
                </div>

                {searchState.results.length > 0 ? (
                  <div className="mt-2 grid gap-1">
                    {searchState.results.map((profile) => (
                      <button
                        aria-label={`Assign to ${profile.name}`}
                        className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-900"
                        disabled={busy}
                        key={profile.id}
                        onClick={() => void assign(item, profile.id)}
                        type="button"
                      >
                        <span className="font-semibold">{profile.name}</span>
                        <span className="text-xs text-slate-500">
                          {[profile.city, profile.region].filter(Boolean).join(", ")}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="mt-4 flex justify-end border-t border-slate-100 pt-3 dark:border-slate-800">
                  <button
                    className="text-sm font-semibold text-slate-600 hover:text-rose-700 disabled:opacity-50 dark:text-slate-300"
                    disabled={busy}
                    onClick={() => void ignore(item)}
                    type="button"
                  >
                    Ignore this email
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
