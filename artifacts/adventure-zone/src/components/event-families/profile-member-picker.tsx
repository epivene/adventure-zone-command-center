import { useState } from "react";

import { apiGet } from "@/lib/auth-token";
import type { OrganizationListPage } from "@/features/organizations/organization-repository";

type Candidate = OrganizationListPage["records"][number];

export function ProfileMemberPicker({
  familyId,
  disabled = false,
  onSelectMany,
}: {
  familyId: string;
  disabled?: boolean;
  onSelectMany: (profileIds: string[]) => Promise<void> | void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  function membershipLabel(candidate: Candidate) {
    if (candidate.eventFamilyId === familyId) return "Already in this family";
    if (candidate.eventFamilyId) return "Already in another event family";
    if (candidate.parentContext?.kind === "organization_group") {
      return `Location of ${candidate.parentContext.name}`;
    }
    return null;
  }

  async function search() {
    const term = query.trim();
    if (!term) {
      setResults([]);
      setSelectedIds(new Set());
      setHasSearched(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    setHasSearched(true);
    setSelectedIds(new Set());
    try {
      const qs = new URLSearchParams({
        q: term,
        showMembers: "yes",
        page: "1",
        pageSize: "20",
      });
      const response = await apiGet<{ organizations: OrganizationListPage } | OrganizationListPage>(
        `/organizations?${qs}`,
      );
      const page = "organizations" in response ? response.organizations : response;
      setResults(page.records ?? []);
    } catch (err: any) {
      setError(err?.message ?? "Could not search profiles.");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  function toggleCandidate(candidate: Candidate) {
    if (membershipLabel(candidate)) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(candidate.id)) next.delete(candidate.id);
      else next.add(candidate.id);
      return next;
    });
  }

  async function addSelected() {
    const ids = [...selectedIds];
    if (!ids.length || disabled) return;
    await onSelectMany(ids);
    setSelectedIds(new Set());
    setResults([]);
    setQuery("");
    setHasSearched(false);
  }

  return (
    <div className="grid gap-3">
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <label className="grid min-w-0 flex-1 gap-1 text-sm font-semibold text-slate-700">
          Search profiles
          <input
            aria-label="Search profiles"
            className="bg-white text-slate-950"
            disabled={disabled}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Name, city, contact, phone, or email"
            value={query}
          />
        </label>
        <button className="button-secondary self-end" disabled={disabled || loading || !query.trim()} type="submit">
          {loading ? "Searching…" : "Search"}
        </button>
      </form>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {error}
          <button className="ml-2 font-bold underline" onClick={() => void search()} type="button">Retry</button>
        </div>
      ) : null}

      {!error && hasSearched ? (
        <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2">
          {results.length ? (
            <ul className="grid gap-2">
              {results.map((candidate) => {
                const label = membershipLabel(candidate);
                const selected = selectedIds.has(candidate.id);
                return (
                  <li key={candidate.id}>
                    <label className={label
                      ? "flex cursor-not-allowed items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 opacity-60"
                      : selected
                        ? "flex cursor-pointer items-start gap-3 rounded-lg border border-orange-300 bg-orange-50 px-3 py-3"
                        : "flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-white px-3 py-3 hover:border-orange-200 hover:bg-orange-50/40"}
                    >
                      <input
                        checked={selected}
                        className="mt-1 size-5 shrink-0"
                        disabled={disabled || Boolean(label)}
                        onChange={() => toggleCandidate(candidate)}
                        type="checkbox"
                      />
                      <span className="grid min-w-0 flex-1 gap-0.5">
                        <span className="font-semibold text-slate-950">{candidate.name}</span>
                        <span className="text-sm text-slate-600">
                          {[candidate.city, candidate.region].filter(Boolean).join(", ") || "Location not set"}
                        </span>
                        {label ? <span className="text-xs font-semibold text-amber-700">{label}</span> : null}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          ) : loading ? null : (
            <p className="p-4 text-sm text-slate-500">No matching profiles.</p>
          )}
        </div>
      ) : null}

      {selectedIds.size > 0 ? (
        <button
          className="button-primary w-fit"
          disabled={disabled || loading}
          onClick={() => void addSelected()}
          type="button"
        >
          Add selected ({selectedIds.size})
        </button>
      ) : null}
    </div>
  );
}
