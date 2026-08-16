import { useEffect, useState } from "react";

import { apiGet } from "@/lib/auth-token";
import type { OrganizationListPage } from "@/features/organizations/organization-repository";

type Candidate = OrganizationListPage["records"][number];

export function ProfileMemberPicker({
  familyId,
  disabled = false,
  onSelect,
}: {
  familyId: string;
  disabled?: boolean;
  onSelect: (profileId: string) => Promise<void> | void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  async function search(term = query) {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        q: term.trim(),
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

  useEffect(() => {
    void search("");
  }, []);

  function membershipLabel(candidate: Candidate) {
    if (candidate.eventFamilyId === familyId) return "Already in this family";
    if (candidate.eventFamilyId) return "Already in another event family";
    if (candidate.parentContext?.kind === "organization_group") {
      return `Location of ${candidate.parentContext.name}`;
    }
    return null;
  }

  const selected = results.find((candidate) => candidate.id === selectedId) ?? null;
  const selectedBlocked = Boolean(selected && membershipLabel(selected));

  return (
    <div className="grid gap-3">
      <p className="text-sm text-slate-600">Add any active existing profile or duplicate without creating another record.</p>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <label className="grid min-w-0 flex-1 gap-1 text-sm font-semibold">
          Search all profiles
          <input
            aria-label="Search all profiles"
            disabled={disabled}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Name, city, contact, phone, or email"
            value={query}
          />
        </label>
        <button className="button-secondary self-end" disabled={disabled || loading} type="submit">
          {loading ? "Searching…" : "Search"}
        </button>
      </form>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {error}
          <button className="ml-2 font-bold underline" onClick={() => void search()} type="button">Retry</button>
        </div>
      ) : null}

      {!error ? (
        <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200">
          {results.length ? (
            <ul className="divide-y divide-slate-100">
              {results.map((candidate) => {
                const label = membershipLabel(candidate);
                return (
                  <li key={candidate.id}>
                    <button
                      className={selectedId === candidate.id
                        ? "grid w-full gap-0.5 bg-orange-50 px-3 py-2 text-left"
                        : "grid w-full gap-0.5 px-3 py-2 text-left hover:bg-slate-50"}
                      disabled={disabled}
                      onClick={() => setSelectedId(candidate.id)}
                      type="button"
                    >
                      <span className="font-semibold">{candidate.name}</span>
                      <span className="text-sm text-slate-600">
                        {[candidate.city, candidate.region].filter(Boolean).join(", ") || "Location not set"}
                      </span>
                      {label ? <span className="text-xs font-semibold text-amber-700">{label}</span> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : loading ? null : (
            <p className="p-4 text-sm text-slate-500">No matching profiles.</p>
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          className="button-primary"
          disabled={disabled || !selected || selectedBlocked}
          onClick={() => selected && void onSelect(selected.id)}
          type="button"
        >
          Add existing profile / duplicate
        </button>
        {selectedBlocked ? (
          <span className="text-sm font-medium text-amber-700">
            This profile is already grouped. Remove it from its current family/group before moving it.
          </span>
        ) : null}
      </div>
    </div>
  );
}
