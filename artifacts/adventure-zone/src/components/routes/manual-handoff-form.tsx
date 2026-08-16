import { useMemo, useState, type FormEvent } from "react";
import { apiPost } from "@/lib/auth-token";
import type { TravelLeg } from "@/features/routes/travel-leg-repository";

export type ManualHandoffResource = { id: string; code: string | null; name: string };

type CounterpartKind = "leg" | "external_contact";

export function ManualHandoffForm({ travelLegs, resources, onCreated }: {
  travelLegs: TravelLeg[];
  resources: ManualHandoffResource[];
  onCreated: () => void | Promise<void>;
}) {
  const activeLegs = useMemo(() => travelLegs.filter((leg) => !leg.archivedAt), [travelLegs]);
  const [fromLegId, setFromLegId] = useState(activeLegs[0]?.id ?? "");
  const [counterpartKind, setCounterpartKind] = useState<CounterpartKind>("leg");
  const [toLegId, setToLegId] = useState(activeLegs.find((leg) => leg.id !== fromLegId)?.id ?? "");
  const [runnerName, setRunnerName] = useState("");
  const [runnerPhone, setRunnerPhone] = useState("");
  const [runnerEmail, setRunnerEmail] = useState("");
  const [resourceId, setResourceId] = useState(resources[0]?.id ?? "");
  const [meetupLabel, setMeetupLabel] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!fromLegId || !resourceId || !meetupLabel || !startsAt || !endsAt || !Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))) {
      setError("Choose the leg and equipment, then enter a valid meetup location and time.");
      return;
    }
    if (counterpartKind === "leg" && (!toLegId || toLegId === fromLegId)) {
      setError("Choose a different leg to meet.");
      return;
    }
    if (counterpartKind === "external_contact" && !runnerName.trim()) {
      setError("Runner name is required.");
      return;
    }

    const fromParticipant = { kind: "leg" as const, legId: fromLegId };
    const toParticipant = counterpartKind === "leg"
      ? { kind: "leg" as const, legId: toLegId }
      : {
          kind: "external_contact" as const,
          externalContactId: null,
          displayName: runnerName.trim(),
          phone: runnerPhone.trim() || null,
          email: runnerEmail.trim() || null,
        };
    setBusy(true);
    try {
      await apiPost("/handoffs/manual", {
        fromParticipant,
        toParticipant,
        fromTripId: null,
        toTripId: null,
        resourceId,
        meetupLabel: meetupLabel.trim(),
        meetupLatitude: Number(latitude),
        meetupLongitude: Number(longitude),
        windowStartsAt: new Date(startsAt).toISOString(),
        windowEndsAt: new Date(endsAt).toISOString(),
      });
      setMeetupLabel("");
      setLatitude("");
      setLongitude("");
      setStartsAt("");
      setEndsAt("");
      setRunnerName("");
      setRunnerPhone("");
      setRunnerEmail("");
      await onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not schedule equipment meetup");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4" onSubmit={submit}>
      <div><h3 className="font-bold">Schedule equipment meetup</h3><p className="text-sm text-slate-600">Use this when the swap is known in advance, including an outside runner.</p></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold">From leg<select aria-label="From leg" value={fromLegId} onChange={(e)=>{setFromLegId(e.target.value);if(toLegId===e.target.value)setToLegId(activeLegs.find((leg)=>leg.id!==e.target.value)?.id??"");}}>{activeLegs.map((leg)=><option key={leg.id} value={leg.id}>{leg.name}</option>)}</select></label>
        <label className="grid gap-1 text-sm font-semibold">Equipment<select aria-label="Equipment" value={resourceId} onChange={(e)=>setResourceId(e.target.value)}><option value="">Choose equipment</option>{resources.map((resource)=><option key={resource.id} value={resource.id}>{resource.name}{resource.code ? ` (${resource.code})` : ""}</option>)}</select></label>
      </div>
      <fieldset className="grid gap-2"><legend className="text-sm font-bold">Who are they meeting?</legend><label className="flex items-center gap-2 text-sm"><input checked={counterpartKind==="leg"} name="counterpart" onChange={()=>setCounterpartKind("leg")} type="radio"/>Another Adventure Zone leg</label><label className="flex items-center gap-2 text-sm"><input aria-label="Outside person / runner" checked={counterpartKind==="external_contact"} name="counterpart" onChange={()=>setCounterpartKind("external_contact")} type="radio"/>Outside person / runner</label></fieldset>
      {counterpartKind === "leg" ? <label className="grid gap-1 text-sm font-semibold">Meet leg<select value={toLegId} onChange={(e)=>setToLegId(e.target.value)}><option value="">Choose leg</option>{activeLegs.filter((leg)=>leg.id!==fromLegId).map((leg)=><option key={leg.id} value={leg.id}>{leg.name}</option>)}</select></label> : <div className="grid gap-3 sm:grid-cols-3"><label className="grid gap-1 text-sm font-semibold">Runner name<input aria-label="Runner name" value={runnerName} onChange={(e)=>setRunnerName(e.target.value)}/></label><label className="grid gap-1 text-sm font-semibold">Runner phone<input aria-label="Runner phone" value={runnerPhone} onChange={(e)=>setRunnerPhone(e.target.value)}/></label><label className="grid gap-1 text-sm font-semibold">Runner email<input aria-label="Runner email" value={runnerEmail} onChange={(e)=>setRunnerEmail(e.target.value)} type="email"/></label></div>}
      <label className="grid gap-1 text-sm font-semibold">Meetup location<input aria-label="Meetup location" placeholder="Billings transfer point" value={meetupLabel} onChange={(e)=>setMeetupLabel(e.target.value)}/></label>
      <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm font-semibold">Latitude<input aria-label="Latitude" inputMode="decimal" value={latitude} onChange={(e)=>setLatitude(e.target.value)}/></label><label className="grid gap-1 text-sm font-semibold">Longitude<input aria-label="Longitude" inputMode="decimal" value={longitude} onChange={(e)=>setLongitude(e.target.value)}/></label></div>
      <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm font-semibold">Meetup starts<input aria-label="Meetup starts" type="datetime-local" value={startsAt} onChange={(e)=>setStartsAt(e.target.value)}/></label><label className="grid gap-1 text-sm font-semibold">Meetup ends<input aria-label="Meetup ends" type="datetime-local" value={endsAt} onChange={(e)=>setEndsAt(e.target.value)}/></label></div>
      {error ? <p role="alert" className="text-sm font-semibold text-rose-700">{error}</p> : null}
      <button className="button-primary justify-self-start" disabled={busy} type="submit">{busy ? "Scheduling…" : "Schedule meetup"}</button>
    </form>
  );
}
