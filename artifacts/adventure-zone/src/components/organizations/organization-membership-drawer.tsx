import { useState } from "react";
import { useLocation } from "wouter";

import { apiDelete, apiGet, apiPut } from "@/lib/auth-token";

type Summary = { id: string; name: string; city?: string | null; region?: string | null };
type ChildCandidate = Summary & { currentParent: Summary | null };

export type OrganizationMembershipDrawerProps = {
  mode: "add-child" | "choose-parent";
  profileId: string;
  parentOrganization: { id: string; name: string } | null;
  currentParent: { id: string; name: string } | null;
  open: boolean;
  onClose(): void;
  onChanged(): void;
};

export function OrganizationMembershipDrawer({ mode, profileId, parentOrganization, currentParent, open, onClose, onChanged }: OrganizationMembershipDrawerProps) {
  const [, navigate] = useLocation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<(Summary | ChildCandidate)[]>([]);
  const [selected, setSelected] = useState<(Summary | ChildCandidate) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function search() {
    setBusy(true);
    setError(null);
    try {
      if (mode === "add-child") {
        const response = await apiGet<{ profiles: ChildCandidate[] }>(`/organizations/${profileId}/membership-candidates?q=${encodeURIComponent(query)}`);
        setResults(response.profiles ?? []);
      } else {
        const response = await apiGet<{ organizations: Summary[] }>(`/event-profiles/${profileId}/organization-candidates?q=${encodeURIComponent(query)}`);
        setResults(response.organizations ?? []);
      }
      setSelected(null);
    } catch (e: any) {
      setError(e?.message ?? "Could not search right now.");
      setResults([]);
    } finally {
      setBusy(false);
    }
  }

  async function applySelection() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const childId = mode === "add-child" ? selected.id : profileId;
      const organizationId = mode === "add-child" ? parentOrganization?.id : selected.id;
      if (!organizationId) return;
      await apiPut(`/event-profiles/${childId}/organization`, { organizationId });
      onChanged();
      onClose();
    } catch (e: any) {
      setError(e?.message ?? "Could not update the organization.");
    } finally {
      setBusy(false);
    }
  }

  async function removeMembership() {
    setBusy(true);
    setError(null);
    try {
      await apiDelete(`/event-profiles/${profileId}/organization`);
      onChanged();
      onClose();
    } catch (e: any) {
      setError(e?.message ?? "Could not remove the organization.");
    } finally {
      setBusy(false);
    }
  }

  const selectedChild = mode === "add-child" ? selected as ChildCandidate | null : null;
  const location = (item: Summary) => [item.city, item.region].filter(Boolean).join(", ");
  const actionLabel = selected
    ? mode === "add-child"
      ? selectedChild?.currentParent
        ? `Move to ${parentOrganization?.name ?? "organization"}`
        : `Add to ${parentOrganization?.name ?? "organization"}`
      : `Add to ${selected.name}`
    : "Choose a profile";

  return (
    <div aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4" role="dialog">
      <div className="grid max-h-[85vh] w-full max-w-2xl gap-4 overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">{mode === "add-child" ? "Add location/event" : currentParent ? "Change organization" : "Add to organization"}</h2>
            <p className="mt-1 text-sm text-slate-600">{mode === "add-child" ? "Find an existing profile or create a new one." : "Choose the organization this profile belongs to."}</p>
          </div>
          <button className="button-secondary" onClick={onClose} type="button">Close</button>
        </div>

        {mode === "add-child" ? (
          <button className="button-secondary justify-self-start" onClick={() => navigate(`/event-profiles/new?organizationId=${parentOrganization?.id ?? profileId}`)} type="button">Create new</button>
        ) : null}

        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); void search(); }}>
          <label className="grid flex-1 gap-1 text-sm font-semibold">
            {mode === "add-child" ? "Search profiles" : "Search organizations"}
            <input aria-label={mode === "add-child" ? "Search profiles" : "Search organizations"} onChange={(event) => setQuery(event.currentTarget.value)} value={query} />
          </label>
          <button className="button-secondary self-end" disabled={busy} type="submit">Search</button>
        </form>

        <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200">
          {results.length ? <ul className="divide-y divide-slate-100">{results.map((item) => {
            const candidate = item as ChildCandidate;
            return <li key={item.id}><button aria-label={`${item.name}${location(item) ? ` ${location(item)}` : ""}`} className={selected?.id === item.id ? "grid w-full gap-1 bg-orange-50 px-3 py-2 text-left" : "grid w-full gap-1 px-3 py-2 text-left hover:bg-slate-50"} onClick={() => setSelected(item)} type="button">
              <span className="font-semibold">{item.name}</span>
              {location(item) ? <span className="text-sm text-slate-600">{location(item)}</span> : null}
              {mode === "add-child" && candidate.currentParent ? <span className="text-xs font-semibold text-amber-700">Currently belongs to {candidate.currentParent.name}</span> : null}
            </button></li>;
          })}</ul> : <p className="p-4 text-sm text-slate-500">Search to find matching profiles.</p>}
        </div>

        {selectedChild?.currentParent ? <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">This profile currently belongs to {selectedChild.currentParent.name}. Moving it changes only its organization relationship; its notes, calls, bookings, follow-ups, and history stay on the profile.</p> : null}
        {error ? <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800" role="alert">{error}</p> : null}

        <div className="flex flex-wrap items-center justify-between gap-2">
          {mode === "choose-parent" && currentParent ? <button className="button-secondary" disabled={busy} onClick={() => void removeMembership()} type="button">Remove from organization</button> : <span />}
          <button className="button-primary" disabled={busy || !selected} onClick={() => void applySelection()} type="button">{actionLabel}</button>
        </div>
      </div>
    </div>
  );
}
