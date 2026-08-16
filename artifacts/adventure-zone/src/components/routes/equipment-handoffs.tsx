import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "@/lib/auth-token";
import type { TravelLeg } from "@/features/routes/travel-leg-repository";
import { ManualHandoffForm, type ManualHandoffResource } from "./manual-handoff-form";

export type HandoffParticipantView =
  | { kind: "leg"; legId: string; legName: string }
  | { kind: "external_contact"; externalContactId: string | null; displayName: string; phone: string | null; email: string | null };

export type EquipmentHandoffView = {
  id: string;
  status: "suggested" | "dismissed" | "approved" | "needs_review";
  fromLegId: string | null;
  toLegId: string | null;
  fromParticipant?: HandoffParticipantView;
  toParticipant?: HandoffParticipantView;
  fromTripId: string | null;
  toTripId: string | null;
  resourceId: string;
  resourceCode: string | null;
  resourceName: string | null;
  meetupLabel: string;
  meetupLatitude: number;
  meetupLongitude: number;
  windowStartsAt: string | Date;
  windowEndsAt: string | Date;
  directMiles: number | null;
  directMinutes: number | null;
  combinedDetourMiles: number;
  availableBufferMinutes: number | null;
  opportunityBand: "strong" | "possible" | "weak";
  explanation: string;
  approvedAt: string | Date | null;
};

type Preview = {
  meetupLabel: string;
  meetupLatitude: number;
  meetupLongitude: number;
  fromTravelMiles: number;
  fromTravelMinutes: number;
  toTravelMiles: number;
  toTravelMinutes: number;
  addedDetourMiles: number;
  availableBufferMinutes: number;
  band: "strong" | "possible" | "weak" | "infeasible";
  score: number;
  reasons: string[];
};

function minutesLabel(value: number | null) {
  if (value === null) return "Unknown";
  const rounded = Math.max(0, Math.round(value));
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function bandClass(band: EquipmentHandoffView["opportunityBand"] | "infeasible") {
  if (band === "strong") return "bg-emerald-100 text-emerald-800";
  if (band === "possible") return "bg-amber-100 text-amber-800";
  if (band === "infeasible") return "bg-rose-100 text-rose-800";
  return "bg-slate-100 text-slate-700";
}

function participantLabel(participant: HandoffParticipantView | undefined, fallbackLegId: string | null, legNames: Map<string, string>) {
  if (participant?.kind === "leg") return participant.legName;
  if (participant?.kind === "external_contact") return participant.displayName;
  return fallbackLegId ? legNames.get(fallbackLegId) ?? "Leg" : "Outside runner";
}

export function EquipmentHandoffs({
  travelLegs,
  resources = [],
  onChange,
}: {
  travelLegs: TravelLeg[];
  resources?: ManualHandoffResource[];
  onChange?: (handoffs: EquipmentHandoffView[]) => void;
}) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [handoffs, setHandoffs] = useState<EquipmentHandoffView[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState<EquipmentHandoffView | null>(null);
  const [adjustment, setAdjustment] = useState({ label: "", latitude: "", longitude: "" });
  const [preview, setPreview] = useState<Preview | null>(null);

  const legNames = useMemo(
    () => new Map(travelLegs.map((leg) => [leg.id, leg.name])),
    [travelLegs],
  );
  const uniqueResources = useMemo(() => {
    const byId = new Map<string, ManualHandoffResource>();
    resources.forEach((resource) => byId.set(resource.id, resource));
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [resources]);

  async function load(targetYear = year) {
    const response = await apiGet<{ handoffs: EquipmentHandoffView[] }>(
      `/handoffs?seasonYear=${targetYear}`,
    );
    setHandoffs(response.handoffs);
    onChange?.(response.handoffs);
  }

  useEffect(() => {
    void load(year).catch((e) => setError(e.message));
  }, [year]);

  async function recalculate() {
    setBusy(true);
    setError(null);
    try {
      const response = await apiPost<{ handoffs: EquipmentHandoffView[] }>(
        "/handoffs/suggestions/recalculate",
        { seasonYear: year },
      );
      setHandoffs(response.handoffs);
      onChange?.(response.handoffs);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function approve(handoff: EquipmentHandoffView, adjusted = false) {
    setBusy(true);
    setError(null);
    try {
      const body = adjusted
        ? {
            meetupLabel: adjustment.label,
            latitude: Number(adjustment.latitude),
            longitude: Number(adjustment.longitude),
          }
        : {};
      await apiPost(`/handoffs/${handoff.id}/approve`, body);
      setAdjusting(null);
      setPreview(null);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function dismiss(handoff: EquipmentHandoffView) {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/handoffs/${handoff.id}/dismiss`, {});
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function startAdjust(handoff: EquipmentHandoffView) {
    setAdjusting(handoff);
    setAdjustment({
      label: handoff.meetupLabel,
      latitude: String(handoff.meetupLatitude),
      longitude: String(handoff.meetupLongitude),
    });
    setPreview(null);
  }

  async function previewAdjustment() {
    if (!adjusting) return;
    setBusy(true);
    setError(null);
    try {
      const response = await apiPost<{ preview: Preview }>(
        `/handoffs/${adjusting.id}/preview`,
        {
          meetupLabel: adjustment.label,
          latitude: Number(adjustment.latitude),
          longitude: Number(adjustment.longitude),
        },
      );
      setPreview(response.preview);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const visible = handoffs.filter((handoff) => handoff.status !== "dismissed");

  return (
    <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="handoff-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-orange-700">Equipment routing</p>
          <h2 className="mt-1 text-2xl font-bold" id="handoff-title">Equipment handoff suggestions</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            The planner compares movable equipment across legs, driving time, distance, schedule buffer, and between-event meetup areas. You can also schedule a known swap with another leg or an outside runner.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <label className="grid gap-1 text-xs font-bold text-slate-600">
            Season
            <input className="w-24" type="number" min={2000} max={2200} value={year} onChange={(event) => setYear(Number(event.target.value))} />
          </label>
          <button className="button-primary" disabled={busy} onClick={recalculate} type="button">
            {busy ? "Calculating…" : "Find handoffs"}
          </button>
        </div>
      </div>

      {uniqueResources.length ? <ManualHandoffForm travelLegs={travelLegs} resources={uniqueResources} onCreated={() => load()} /> : <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Assign movable equipment to a leg before scheduling a manual meetup.</p>}

      {error ? <p className="rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</p> : null}

      {visible.length ? (
        <div className="grid gap-3">
          {visible.map((handoff) => (
            <article className={`rounded-xl border p-4 ${handoff.status === "needs_review" ? "border-amber-300 bg-amber-50/40" : "border-slate-200"}`} key={handoff.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-bold capitalize ${bandClass(handoff.opportunityBand)}`}>
                      {handoff.opportunityBand}
                    </span>
                    {handoff.status === "approved" ? <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-bold text-sky-800">Approved route stop</span> : null}
                    {handoff.status === "needs_review" ? <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">Needs review</span> : null}
                  </div>
                  <h3 className="mt-2 text-lg font-bold">{handoff.resourceName ?? handoff.resourceCode ?? "Movable equipment"}</h3>
                  <p className="text-sm font-semibold text-slate-700">
                    {participantLabel(handoff.fromParticipant, handoff.fromLegId, legNames)} → {participantLabel(handoff.toParticipant, handoff.toLegId, legNames)}
                  </p>
                </div>
                <div className="text-right text-sm text-slate-600">
                  <p className="font-bold text-slate-900">{handoff.meetupLabel}</p>
                  <p>{new Date(handoff.windowStartsAt).toLocaleDateString()} – {new Date(handoff.windowEndsAt).toLocaleDateString()}</p>
                </div>
              </div>

              <p className="mt-3 text-sm text-slate-700">{handoff.explanation}</p>
              <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
                <div className="rounded-lg bg-slate-50 p-3"><span className="block text-xs font-bold uppercase text-slate-500">Route distance</span>{handoff.directMiles === null ? "Unknown" : `${handoff.directMiles.toFixed(1)} mi`}</div>
                <div className="rounded-lg bg-slate-50 p-3"><span className="block text-xs font-bold uppercase text-slate-500">Added detour</span>{handoff.combinedDetourMiles.toFixed(1)} mi</div>
                <div className="rounded-lg bg-slate-50 p-3"><span className="block text-xs font-bold uppercase text-slate-500">Available buffer</span>{minutesLabel(handoff.availableBufferMinutes)}</div>
              </div>

              {handoff.status !== "approved" ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <button className="button-primary" disabled={busy} onClick={() => approve(handoff)} type="button">Approve</button>
                  <button className="button-secondary" disabled={busy} onClick={() => startAdjust(handoff)} type="button">Adjust</button>
                  <button className="button-secondary text-rose-700" disabled={busy} onClick={() => dismiss(handoff)} type="button">Dismiss</button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-slate-300 p-5 text-sm text-slate-600">
          No handoff suggestions for {year} yet. Use the form above for a known swap or click <strong>Find handoffs</strong> after assigning movable equipment to trips.
        </div>
      )}

      {adjusting ? (
        <div className="rounded-xl border-2 border-orange-200 bg-orange-50/40 p-4">
          <div className="flex items-start justify-between gap-3">
            <div><h3 className="font-bold">Adjust meetup</h3><p className="text-sm text-slate-600">Change the meetup, preview the route impact, then approve only if it still works.</p></div>
            <button className="text-sm font-bold text-slate-600" onClick={() => { setAdjusting(null); setPreview(null); }} type="button">Close</button>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1 text-sm font-semibold sm:col-span-3">Meetup label<input value={adjustment.label} onChange={(e) => setAdjustment((v) => ({ ...v, label: e.target.value }))} /></label>
            <label className="grid gap-1 text-sm font-semibold">Latitude<input inputMode="decimal" value={adjustment.latitude} onChange={(e) => setAdjustment((v) => ({ ...v, latitude: e.target.value }))} /></label>
            <label className="grid gap-1 text-sm font-semibold">Longitude<input inputMode="decimal" value={adjustment.longitude} onChange={(e) => setAdjustment((v) => ({ ...v, longitude: e.target.value }))} /></label>
            <div className="flex items-end"><button className="button-secondary w-full" disabled={busy || !adjustment.label || !Number.isFinite(Number(adjustment.latitude)) || !Number.isFinite(Number(adjustment.longitude))} onClick={previewAdjustment} type="button">Preview impact</button></div>
          </div>
          {preview ? (
            <div className="mt-3 rounded-lg bg-white p-3 text-sm shadow-sm">
              <div className="flex items-center gap-2"><span className={`rounded-full px-2 py-1 text-xs font-bold capitalize ${bandClass(preview.band)}`}>{preview.band}</span><strong>{preview.meetupLabel}</strong></div>
              <p className="mt-2">Crew A travel: {preview.fromTravelMiles.toFixed(1)} mi / {minutesLabel(preview.fromTravelMinutes)} · Crew B travel: {preview.toTravelMiles.toFixed(1)} mi / {minutesLabel(preview.toTravelMinutes)}</p>
              <p className="mt-1">Added detour: {preview.addedDetourMiles.toFixed(1)} mi · Buffer: {minutesLabel(preview.availableBufferMinutes)}</p>
              <p className="mt-1 text-slate-600">{preview.reasons.join(" ")}</p>
              <button className="button-primary mt-3" disabled={busy || preview.band === "infeasible"} onClick={() => approve(adjusting, true)} type="button">Approve adjusted handoff</button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}