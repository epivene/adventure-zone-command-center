import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/auth-token";
import type { ManagerRouteSuggestionView } from "@/components/manager/route-suggestion-history";

type AdminSuggestion = ManagerRouteSuggestionView & {
  legId: string;
  beforeJson: Record<string, unknown> | null;
  proposedJson: Record<string, unknown>;
};

function jsonSummary(value: Record<string, unknown> | null) {
  if (!value) return "None";
  return Object.entries(value).map(([key, item]) => `${key}: ${String(item)}`).join(" · ");
}

export function ManagerRouteReviewQueue({ onApproved }: { onApproved?: () => Promise<void> | void }) {
  const [suggestions, setSuggestions] = useState<AdminSuggestion[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    const response = await apiGet<{ suggestions: AdminSuggestion[] }>("/manager-travel-admin/suggestions");
    setSuggestions(response.suggestions ?? []);
  }
  useEffect(() => { void load().catch((e) => setError(e instanceof Error ? e.message : "Could not load route suggestions")); }, []);

  async function approve(id: string) {
    setBusyId(id); setError(""); setMessage("");
    try {
      await apiPost(`/manager-travel-admin/suggestions/${id}/approve`, {});
      setMessage("Route change approved.");
      await load();
      await onApproved?.();
    } catch (e) {
      const text = e instanceof Error ? e.message : "Could not approve route change";
      setError(text === "STALE" ? "Official route changed; review again before approving." : text);
    } finally { setBusyId(null); }
  }
  async function reject(id: string) {
    const response = window.prompt("Optional note for the manager:", "") ?? null;
    setBusyId(id); setError(""); setMessage("");
    try {
      await apiPost(`/manager-travel-admin/suggestions/${id}/reject`, { adminResponse: response });
      setMessage("Route change rejected.");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not reject route change"); }
    finally { setBusyId(null); }
  }

  return (
    <section className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby="manager-route-review-title">
      <div><p className="text-xs font-bold uppercase tracking-[0.14em] text-orange-700">Manager planning</p><h2 id="manager-route-review-title" className="text-xl font-bold">Route changes awaiting approval</h2><p className="mt-1 text-sm text-slate-600">Managers can suggest official itinerary changes, but nothing changes until you approve it here.</p></div>
      {error ? <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</p> : null}
      {message ? <p role="status" className="text-sm font-semibold text-emerald-700">{message}</p> : null}
      {suggestions.length ? <div className="grid gap-3">{suggestions.map((suggestion) => <article key={suggestion.id} className="grid gap-2 rounded-xl border border-slate-200 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-bold capitalize">{suggestion.kind.replaceAll("_", " ")}</p><p className="text-xs text-slate-500">Leg {suggestion.legId}</p></div>{suggestion.stale ? <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800">Needs review</span> : <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800">Pending</span>}</div><p className="text-sm"><strong>Reason:</strong> {suggestion.reason}</p><div className="grid gap-2 text-xs sm:grid-cols-2"><div className="rounded-lg bg-slate-50 p-3"><strong className="block text-slate-500">Current</strong>{jsonSummary(suggestion.beforeJson)}</div><div className="rounded-lg bg-sky-50 p-3"><strong className="block text-sky-700">Proposed</strong>{jsonSummary(suggestion.proposedJson)}</div></div><div className="flex flex-wrap gap-2"><button type="button" className="button-primary" disabled={busyId === suggestion.id || suggestion.stale} onClick={() => approve(suggestion.id)}>{busyId === suggestion.id ? "Working…" : "Approve"}</button><button type="button" className="button-secondary" disabled={busyId === suggestion.id} onClick={() => reject(suggestion.id)}>Reject</button></div></article>)}</div> : <div className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-600">No manager route changes are waiting for approval.</div>}
    </section>
  );
}
