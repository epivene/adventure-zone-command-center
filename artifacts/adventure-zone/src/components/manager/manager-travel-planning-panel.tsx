import { useEffect, useState, type FormEvent } from "react";
import type { ManagerScopedMapData } from "@/features/manager/manager-map-types";
import { RouteSuggestionForm, type RouteSuggestionDraft } from "./route-suggestion-form";
import { RouteSuggestionHistory, type ManagerRouteSuggestionView } from "./route-suggestion-history";

type ManagerApi = <T = any>(path: string, init?: RequestInit & { body?: any }) => Promise<T>;
type FuelObservation = { id: string; pricePerGallon: number; locationLabel: string; observedAt: string | Date; note: string | null };

function localDateTimeValue(date = new Date()) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

export function ManagerTravelPlanningPanel({ managerApi, tripId, mapData, compact = false }: {
  managerApi: ManagerApi;
  tripId: string | null;
  mapData: ManagerScopedMapData;
  compact?: boolean;
}) {
  const [price, setPrice] = useState("");
  const [location, setLocation] = useState("");
  const [observedAt, setObservedAt] = useState(localDateTimeValue);
  const [note, setNote] = useState("");
  const [observations, setObservations] = useState<FuelObservation[]>([]);
  const [suggestions, setSuggestions] = useState<ManagerRouteSuggestionView[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const [fuel, changes] = await Promise.all([
      managerApi<{ observations: FuelObservation[] }>("/manager/travel/fuel-prices"),
      compact ? Promise.resolve({ suggestions: [] as ManagerRouteSuggestionView[] }) : managerApi<{ suggestions: ManagerRouteSuggestionView[] }>("/manager/travel/suggestions"),
    ]);
    setObservations(fuel.observations ?? []);
    if (!compact) setSuggestions(changes.suggestions ?? []);
  }

  useEffect(() => { void load().catch((e) => setError(e instanceof Error ? e.message : "Could not load travel planning")); }, [compact]);

  async function saveFuel(event: FormEvent) {
    event.preventDefault();
    const numericPrice = Number(price);
    if (!Number.isFinite(numericPrice) || numericPrice <= 0 || !location.trim()) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await managerApi("/manager/travel/fuel-prices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tripId,
          pricePerGallon: numericPrice,
          locationLabel: location.trim(),
          observedAt: new Date(observedAt).toISOString(),
          note: note.trim() || null,
        }),
      });
      setPrice(""); setNote(""); setObservedAt(localDateTimeValue()); setMessage("Fuel price saved.");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Fuel price could not be saved"); }
    finally { setBusy(false); }
  }

  async function submitSuggestion(draft: RouteSuggestionDraft) {
    setError(""); setMessage("");
    await managerApi("/manager/travel/suggestions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft),
    });
    setMessage("Route change sent for approval.");
    await load();
  }

  return (
    <section className="grid gap-4" aria-label={compact ? "Quick travel updates" : "Travel planning tools"}>
      <form className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4" onSubmit={saveFuel}>
        <div><h2 className="font-bold">Update local fuel price</h2><p className="text-sm text-slate-600">Keep route fuel estimates grounded in what you are actually seeing on the road.</p></div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-semibold">Price per gallon<input aria-label="Price per gallon" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="3.49" /></label>
          <label className="grid gap-1 text-sm font-semibold">Location<input aria-label="Fuel price location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Dickinson, ND" /></label>
          <label className="grid gap-1 text-sm font-semibold">Observed<input type="datetime-local" value={observedAt} onChange={(e) => setObservedAt(e.target.value)} /></label>
          <label className="grid gap-1 text-sm font-semibold">Note<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" /></label>
        </div>
        <button className="button-primary" disabled={busy || Number(price) <= 0 || !location.trim()}>{busy ? "Saving…" : "Save fuel price"}</button>
        {message ? <p role="status" className="text-sm font-semibold text-emerald-700">{message}</p> : null}
        {error ? <p role="alert" className="text-sm font-semibold text-rose-700">{error}</p> : null}
        {observations[0] ? <p className="text-xs text-slate-500">Latest: ${Number(observations[0].pricePerGallon).toFixed(3)} · {observations[0].locationLabel}</p> : null}
      </form>

      {!compact ? <>
        <RouteSuggestionForm data={mapData} onSubmit={submitSuggestion} />
        <section className="grid gap-2"><div><h2 className="font-bold">Suggested route changes</h2><p className="text-sm text-slate-600">Pending suggestions do not change the official itinerary until admin approves them.</p></div><RouteSuggestionHistory suggestions={suggestions} /></section>
      </> : null}
    </section>
  );
}
