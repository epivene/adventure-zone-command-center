import { useMemo, useState, type FormEvent } from "react";
import type { ManagerScopedMapData } from "@/features/manager/manager-map-types";

export type RouteSuggestionDraft = {
  targetType: "trip" | "trip_stop" | "booking" | "handoff";
  targetId: string;
  kind: "reorder_stop" | "change_event_time" | "change_meetup_time_or_location" | "remove_stop" | "other_route_change";
  proposedJson: Record<string, unknown>;
  reason: string;
};

type Kind = RouteSuggestionDraft["kind"];

export function RouteSuggestionForm({ data, onSubmit }: {
  data: ManagerScopedMapData;
  onSubmit: (draft: RouteSuggestionDraft) => Promise<void>;
}) {
  const [kind, setKind] = useState<Kind>("reorder_stop");
  const [targetId, setTargetId] = useState("");
  const [position, setPosition] = useState("1");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [meetupLabel, setMeetupLabel] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [proposal, setProposal] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const options = useMemo(() => {
    if (kind === "reorder_stop" || kind === "remove_stop") {
      return (data.route?.stops ?? []).map((stop) => ({ id: stop.id, label: stop.bookingName, type: "trip_stop" as const }));
    }
    if (kind === "change_event_time") return data.events.map((event) => ({ id: event.bookingId, label: event.bookingName, type: "booking" as const }));
    if (kind === "change_meetup_time_or_location") return data.meetups.map((meetup) => ({ id: meetup.id, label: meetup.meetupLabel, type: "handoff" as const }));
    return data.route ? [{ id: data.route.trip.id, label: data.route.trip.name, type: "trip" as const }] : [];
  }, [data, kind]);

  const selected = options.find((option) => option.id === targetId) ?? options[0] ?? null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selected || !reason.trim()) return;
    let proposedJson: Record<string, unknown>;
    if (kind === "reorder_stop") proposedJson = { sortOrder: Number(position) };
    else if (kind === "remove_stop") proposedJson = { remove: true };
    else if (kind === "change_event_time") proposedJson = { ...(start ? { startsAt: new Date(start).toISOString() } : {}), ...(end ? { endsAt: new Date(end).toISOString() } : {}) };
    else if (kind === "change_meetup_time_or_location") proposedJson = {
      ...(meetupLabel.trim() ? { meetupLabel: meetupLabel.trim() } : {}),
      ...(latitude ? { latitude: Number(latitude) } : {}),
      ...(longitude ? { longitude: Number(longitude) } : {}),
      ...(start ? { windowStartsAt: new Date(start).toISOString() } : {}),
      ...(end ? { windowEndsAt: new Date(end).toISOString() } : {}),
    };
    else proposedJson = { description: proposal.trim() };
    if (!Object.keys(proposedJson).length) return;
    setBusy(true);
    try {
      await onSubmit({ targetType: selected.type, targetId: selected.id, kind, proposedJson, reason: reason.trim() });
      setReason(""); setProposal(""); setStart(""); setEnd("");
    } finally { setBusy(false); }
  }

  return (
    <form className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4" onSubmit={submit}>
      <div><h3 className="font-bold">Suggest change</h3><p className="text-sm text-slate-600">Official route changes stay pending until admin approves them.</p></div>
      <label className="grid gap-1 text-sm font-semibold">Change type
        <select value={kind} onChange={(event) => { setKind(event.target.value as Kind); setTargetId(""); }}>
          <option value="reorder_stop">Reorder a stop</option><option value="remove_stop">Remove a stop</option><option value="change_event_time">Change event time</option><option value="change_meetup_time_or_location">Change meetup time/location</option><option value="other_route_change">Other route change</option>
        </select>
      </label>
      <label className="grid gap-1 text-sm font-semibold">Target
        <select aria-label="Route change target" value={selected?.id ?? ""} onChange={(event) => setTargetId(event.target.value)} disabled={!options.length}>
          {options.length ? options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>) : <option value="">No matching route item</option>}
        </select>
      </label>
      {kind === "reorder_stop" ? <label className="grid gap-1 text-sm font-semibold">New position<input type="number" min="1" value={position} onChange={(e) => setPosition(e.target.value)} /></label> : null}
      {kind === "change_event_time" ? <div className="grid gap-2 sm:grid-cols-2"><label className="grid gap-1 text-sm font-semibold">New start<input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></label><label className="grid gap-1 text-sm font-semibold">New end<input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></label></div> : null}
      {kind === "change_meetup_time_or_location" ? <div className="grid gap-2 sm:grid-cols-2"><label className="grid gap-1 text-sm font-semibold sm:col-span-2">Meetup location<label className="sr-only">Meetup label</label><input value={meetupLabel} onChange={(e) => setMeetupLabel(e.target.value)} placeholder="New meetup label" /></label><label className="grid gap-1 text-sm font-semibold">Latitude<input inputMode="decimal" value={latitude} onChange={(e) => setLatitude(e.target.value)} /></label><label className="grid gap-1 text-sm font-semibold">Longitude<input inputMode="decimal" value={longitude} onChange={(e) => setLongitude(e.target.value)} /></label><label className="grid gap-1 text-sm font-semibold">Window start<input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></label><label className="grid gap-1 text-sm font-semibold">Window end<input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></label></div> : null}
      {kind === "other_route_change" ? <label className="grid gap-1 text-sm font-semibold">Proposed change<textarea rows={3} value={proposal} onChange={(e) => setProposal(e.target.value)} /></label> : null}
      <label className="grid gap-1 text-sm font-semibold">Why?<textarea required rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <button className="button-primary" disabled={busy || !selected || !reason.trim()}>{busy ? "Submitting…" : "Send for approval"}</button>
    </form>
  );
}
