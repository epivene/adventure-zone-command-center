import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/auth-token";
import type { EventFamilySuggestion } from "@/features/event-families/event-family-types";

export function EventFamilySuggestions({ onChanged, compact = false }: { onChanged?: () => void; compact?: boolean }) {
  const [suggestions, setSuggestions] = useState<EventFamilySuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(!compact);

  async function load() {
    try {
      const result = await apiGet<{ suggestions: EventFamilySuggestion[] }>("/event-family-suggestions");
      setSuggestions(result.suggestions);
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? "Could not load event-family suggestions");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function analyze() {
    setAnalyzing(true);
    setError(null);
    try {
      const result = await apiPost<{ suggestions?: EventFamilySuggestion[] }>("/event-family-suggestions/analyze", {});
      if (result.suggestions) setSuggestions(result.suggestions);
      else await load();
    } catch (err: any) {
      setError(err?.message ?? "Could not analyze event families");
    } finally { setAnalyzing(false); }
  }

  async function act(id: string, action: "approve" | "dismiss") {
    setSavingId(id);
    setError(null);
    try {
      await apiPost(`/event-family-suggestions/${id}/${action}`, {});
      setSuggestions((current) => current.filter((item) => item.id !== id));
      onChanged?.();
    } catch (err: any) {
      setError(err?.message ?? "Could not update suggestion");
    } finally { setSavingId(null); }
  }

  if (compact && !open) {
    return <button className="button-secondary text-sm" onClick={() => setOpen(true)} type="button">Suggest families{!loading && suggestions.length > 0 ? <span className="ml-2 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-bold text-orange-800">{suggestions.length}</span> : null}</button>;
  }

  return (
    <section className={`${compact ? "w-full basis-full" : ""} rounded-xl border border-slate-200 bg-white p-4 shadow-sm`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-lg font-bold">Event family suggestions</h2><p className="mt-1 text-sm text-slate-600">Suggestions never merge or delete the original profiles. You approve every grouping.</p></div>
        <div className="flex flex-wrap gap-2"><button className="button-secondary" disabled={analyzing || savingId !== null} onClick={analyze} type="button">{analyzing ? "Analyzing…" : "Analyze event names"}</button>{compact ? <button className="button-secondary" onClick={() => setOpen(false)} type="button">Close</button> : null}</div>
      </div>
      {error ? <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}<button className="ml-2 font-bold underline" onClick={load} type="button">Retry</button></div> : null}
      {loading ? <p className="mt-4 text-sm text-slate-500">Loading suggestions…</p> : null}
      {!loading && suggestions.length === 0 ? <p className="mt-4 text-sm text-slate-500">No event-family suggestions are waiting for review.</p> : null}
      <div className="mt-4 grid gap-3">
        {suggestions.map((suggestion) => {
          const label = suggestion.source === "rule" ? "Exact name match" : suggestion.confidence >= 0.85 ? "AI suggestion · High confidence" : "AI suggestion · Review carefully";
          const saving = savingId === suggestion.id;
          return <article key={suggestion.id} className="rounded-lg border border-slate-200 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.12em] text-orange-700">{label}</p><h3 className="mt-1 font-bold text-slate-900">{suggestion.proposedName}</h3><p className="mt-1 text-sm text-slate-600">{suggestion.reason}</p></div>{suggestion.source === "ai" ? <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">{Math.round(suggestion.confidence * 100)}%</span> : null}</div><ul className="mt-3 grid gap-1 text-sm text-slate-700">{(suggestion.candidates ?? []).map((candidate) => <li key={candidate.id}><strong>{candidate.name}</strong>{candidate.city || candidate.region ? ` · ${[candidate.city, candidate.region].filter(Boolean).join(", ")}` : ""}</li>)}</ul><div className="mt-4 flex flex-wrap gap-2"><button className="button-primary" disabled={savingId !== null} onClick={() => act(suggestion.id, "approve")} type="button">{saving ? "Saving…" : "Group these events"}</button><button className="button-secondary" disabled={savingId !== null} onClick={() => act(suggestion.id, "dismiss")} type="button">Not related</button></div></article>;
        })}
      </div>
    </section>
  );
}
