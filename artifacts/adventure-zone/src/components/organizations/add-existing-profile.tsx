import { useEffect, useState } from "react";

import type { OrganizationListPage } from "@/features/organizations/organization-repository";
import { apiGet, apiPost } from "@/lib/auth-token";

type Candidate = OrganizationListPage["records"][number];

export function AddExistingProfile({ orgId, onAdded }: { orgId: string; onAdded: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function search(term = query) {
    setBusy(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ q: term.trim(), showMembers: "yes", page: "1", pageSize: "20" });
      const response = await apiGet<{ organizations: OrganizationListPage } | OrganizationListPage>(`/organizations?${qs}`);
      const page = "organizations" in response ? response.organizations : response;
      setResults((page.records ?? []).filter((candidate) => candidate.id !== orgId));
    } catch (err: any) {
      setError(err?.message ?? "Could not search profiles.");
      setResults([]);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void search(""); }, [orgId]);

  async function addSelected() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const label = [selected.city, selected.region].filter(Boolean).join(", ") || selected.name;
      await apiPost(`/organizations/${orgId}/add-profile`, { sourceOrgId: selected.id, label });
      setMessage(`${selected.name} was added to this organization.`);
      setSelected(null);
      await search(query);
      onAdded();
    } catch (err: any) {
      setError(err?.message ?? "Could not add this profile.");
    } finally {
      setBusy(false);
    }
  }

  function blockedReason(candidate: Candidate) {
    if (candidate.eventFamilyId) return "In an event family";
    if (candidate.parentContext?.kind === "organization_group") return `Already grouped under ${candidate.parentContext.name}`;
    return null;
  }

  const blocked = selected ? blockedReason(selected) : null;

  return (
    <section className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4">
      <div>
        <h3 className="font-bold">Add existing profile or duplicate</h3>
        <p className="mt-1 text-sm text-slate-600">
          Turn an existing profile into a location under this organization while keeping its calls, notes, bookings, and follow-ups tied to that location.
        </p>
      </div>

      <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); void search(); }}>
        <label className="grid min-w-0 flex-1 gap-1 text-sm font-semibold">
          Search profiles
          <input
            aria-label="Search profiles to add"
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Name, city, contact, phone, or email"
            value={query}
          />
        </label>
        <button className="button-secondary self-end" disabled={busy} type="submit">{busy ? "Working…" : "Search"}</button>
      </form>

      <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200">
        {results.length ? (
          <ul className="divide-y divide-slate-100">
            {results.map((candidate) => {
              const reason = blockedReason(candidate);
              return (
                <li key={candidate.id}>
                  <button
                    className={selected?.id === candidate.id ? "grid w-full gap-0.5 bg-orange-50 px-3 py-2 text-left" : "grid w-full gap-0.5 px-3 py-2 text-left hover:bg-slate-50"}
                    onClick={() => setSelected(candidate)}
                    type="button"
                  >
                    <span className="font-semibold">{candidate.name}</span>
                    <span className="text-sm text-slate-600">{[candidate.city, candidate.region].filter(Boolean).join(", ") || "Location not set"}</span>
                    {reason ? <span className="text-xs font-semibold text-amber-700">{reason}</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : busy ? null : <p className="p-4 text-sm text-slate-500">No matching active profiles.</p>}
      </div>

      {error ? <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
      {message ? <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <button className="button-primary" disabled={busy || !selected || Boolean(blocked)} onClick={() => void addSelected()} type="button">
          Add profile to organization
        </button>
        {blocked ? <span className="text-sm font-medium text-amber-700">Remove this profile from its current group first.</span> : null}
      </div>
    </section>
  );
}
