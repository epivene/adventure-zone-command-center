import { useEffect, useState } from "react";
import { useSearch } from "wouter";
import { apiDelete, apiGet, apiPatch } from "@/lib/auth-token";
import { EventWrapUpReviewQueue } from "@/components/routes/event-wrap-up-review-queue";
import EventWrapUpAdminPage from "@/pages/EventWrapUpAdminPage";
import { LegEventRecordGroups } from "@/components/records/leg-event-record-groups";

function Detail({ label, value }: { label: string; value: any }) {
  if (value === null || value === undefined || value === "") return null;
  return <p className="text-sm"><span className="font-semibold">{label}:</span> {String(value)}</p>;
}

function dateTime(value: any) {
  return value ? new Date(value).toLocaleString() : null;
}

function dateTimeLocal(value: any) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

type IncidentDraft = {
  type: string;
  occurredAt: string;
  locationText: string;
  peopleInvolved: string;
  description: string;
  actionTaken: string;
  followUpNeeded: boolean;
};

function draftFromIncident(incident: any): IncidentDraft {
  return {
    type: String(incident.type ?? ""),
    occurredAt: dateTimeLocal(incident.occurredAt),
    locationText: String(incident.locationText ?? ""),
    peopleInvolved: String(incident.peopleInvolved ?? ""),
    description: String(incident.description ?? ""),
    actionTaken: String(incident.actionTaken ?? ""),
    followUpNeeded: Boolean(incident.followUpNeeded),
  };
}

export default function ManagerAftermathAdminPage() {
  const search = useSearch();
  const selectedWrapUp = new URLSearchParams(search).get("wrapUp");
  const [wrapUps, setWrapUps] = useState<any[]>([]);
  const [lifecycles, setLifecycles] = useState<any[]>([]);
  const [reviews, setReviews] = useState<any[]>([]);
  const [incidents, setIncidents] = useState<any[]>([]);
  const [followOnly, setFollowOnly] = useState(false);
  const [openReview, setOpenReview] = useState<string | null>(null);
  const [openIncident, setOpenIncident] = useState<string | null>(null);
  const [editingIncident, setEditingIncident] = useState<string | null>(null);
  const [incidentDraft, setIncidentDraft] = useState<IncidentDraft | null>(null);
  const [incidentBusy, setIncidentBusy] = useState<string | null>(null);
  const [incidentError, setIncidentError] = useState<string | null>(null);
  const [incidentLoadError, setIncidentLoadError] = useState<string | null>(null);

  async function loadIncidents() {
    setIncidentLoadError(null);
    try {
      const incidentData = await apiGet<any>("/manager-admin/incidents");
      setIncidents(incidentData.incidents ?? []);
    } catch (error) {
      setIncidentLoadError(error instanceof Error ? error.message : "Could not load incidents.");
    }
  }

  useEffect(() => {
    if (selectedWrapUp) return;
    void apiGet<any>("/event-wrap-up-admin")
      .then((data) => setWrapUps(data.wrapUps ?? []))
      .catch(() => setWrapUps([]));
    void apiGet<any>("/manager-admin/events/lifecycle")
      .then((data) => setLifecycles(data.lifecycles ?? []))
      .catch(() => setLifecycles([]));
    void apiGet<any>("/manager-admin/reviews")
      .then((data) => setReviews(data.reviews ?? []))
      .catch(() => setReviews([]));
    void loadIncidents();
  }, [selectedWrapUp]);

  function beginEdit(incident: any) {
    setOpenIncident(incident.id);
    setEditingIncident(incident.id);
    setIncidentDraft(draftFromIncident(incident));
    setIncidentError(null);
  }

  function cancelEdit() {
    setEditingIncident(null);
    setIncidentDraft(null);
    setIncidentError(null);
  }

  async function saveIncident(incident: any) {
    if (!incidentDraft || incidentBusy) return;
    if (!incidentDraft.type.trim() || !incidentDraft.description.trim() || !incidentDraft.occurredAt) {
      setIncidentError("Type, occurred date/time, and description are required.");
      return;
    }
    setIncidentBusy(`save:${incident.id}`);
    setIncidentError(null);
    try {
      const response = await apiPatch<{ incident: any }>(`/manager-admin/incidents/${incident.id}`, {
        type: incidentDraft.type.trim(),
        occurredAt: new Date(incidentDraft.occurredAt).toISOString(),
        locationText: incidentDraft.locationText.trim() || null,
        peopleInvolved: incidentDraft.peopleInvolved.trim() || null,
        description: incidentDraft.description.trim(),
        actionTaken: incidentDraft.actionTaken.trim() || null,
        followUpNeeded: incidentDraft.followUpNeeded,
      });
      setIncidents((current) => current.map((item) => item.id === incident.id ? response.incident : item));
      cancelEdit();
    } catch (error) {
      setIncidentError(error instanceof Error ? error.message : "Could not update incident.");
    } finally {
      setIncidentBusy(null);
    }
  }

  async function deleteIncident(incident: any) {
    if (incidentBusy) return;
    const confirmed = window.confirm(`Delete incident “${incident.type}”? This cannot be undone.`);
    if (!confirmed) return;
    setIncidentBusy(`delete:${incident.id}`);
    setIncidentError(null);
    try {
      await apiDelete<{ ok: true }>(`/manager-admin/incidents/${incident.id}`);
      setIncidents((current) => current.filter((item) => item.id !== incident.id));
      if (openIncident === incident.id) setOpenIncident(null);
      if (editingIncident === incident.id) cancelEdit();
    } catch (error) {
      setIncidentError(error instanceof Error ? error.message : "Could not delete incident.");
    } finally {
      setIncidentBusy(null);
    }
  }

  if (selectedWrapUp) return <EventWrapUpAdminPage bookingId={selectedWrapUp} />;

  const visibleIncidents = incidents.filter((incident) => !followOnly || incident.followUpNeeded);

  return <div className="mx-auto grid max-w-5xl gap-6">
    <header>
      <h1 className="text-3xl font-bold">Event aftermath</h1>
      <p className="text-slate-600">Review check-ins, closeouts, ratings, cash settlement, and incidents across all travel legs.</p>
    </header>

    <section className="grid gap-3">
      <div><h2 className="text-xl font-bold">Event activity</h2><p className="text-sm text-slate-600">Manager arrival, departure, and wrap-up status.</p></div>
      {lifecycles.length ? lifecycles.map((item) => <article key={item.id} className="rounded-xl border bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div><h3 className="font-bold">{item.bookingName}</h3><p className="text-sm text-slate-600">{item.legName} · {[item.city,item.region].filter(Boolean).join(", ")}</p></div>
          <span className={`rounded-full px-2 py-1 text-xs font-bold ${item.wrapUpStatus === "finished" ? "bg-emerald-100 text-emerald-800" : item.wrapUpStatus === "incomplete" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700"}`}>{String(item.wrapUpStatus).replaceAll("_"," ")}</span>
        </div>
        <div className="mt-3 grid gap-1"><Detail label="Checked in" value={dateTime(item.checkedInAt)} /><Detail label="Check-in location" value={item.checkInLatitude != null && item.checkInLongitude != null ? `${item.checkInLatitude}, ${item.checkInLongitude}` : item.checkInLocationStatus} /><Detail label="Checked out" value={dateTime(item.checkedOutAt)} /><Detail label="Check-out location" value={item.checkOutLatitude != null && item.checkOutLongitude != null ? `${item.checkOutLatitude}, ${item.checkOutLongitude}` : item.checkOutLocationStatus} /></div>
      </article>) : <p className="rounded-xl border border-dashed bg-white p-4 text-sm text-slate-600">No event check-ins yet.</p>}
    </section>

    <section className="grid gap-3">
      <div>
        <h2 className="text-xl font-bold">Wrap-ups waiting for review</h2>
        <p className="text-sm text-slate-600">These are the current post-event closeouts submitted by managers.</p>
      </div>
      <EventWrapUpReviewQueue wrapUps={wrapUps} />
    </section>

    <section>
      <h2 className="text-xl font-bold">Legacy reviews</h2>
      <p className="text-sm text-slate-600">{reviews.length} historical reviews from the older aftermath form.</p>
      <LegEventRecordGroups records={reviews} noun="review">{(review) => {
        const open = openReview === review.id;
        return <article key={review.id} className="rounded-xl border bg-white">
          <button type="button" aria-expanded={open} className="w-full p-3 text-left" onClick={() => setOpenReview(open ? null : review.id)}>
            <div className="flex items-center justify-between gap-3"><span><b>{review.rating}/5</b></span><span className="text-sm font-semibold text-orange-700">{open ? "Hide details" : "View details"}</span></div>
            {review.feedback ? <p className="mt-1">{review.feedback}</p> : null}
          </button>
          {open ? <div className="grid gap-1 border-t p-3"><Detail label="Organizer / site notes" value={review.organizerSiteNotes} /><Detail label="Crew notes" value={review.crewNotes} /><Detail label="Submitted" value={review.createdAt ? new Date(review.createdAt).toLocaleString() : null} /></div> : null}
        </article>;
      }}</LegEventRecordGroups>
    </section>

    <section>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold">Incidents</h2>
        <label className="flex items-center gap-2"><input type="checkbox" aria-label="Follow-up only" checked={followOnly} onChange={(event) => setFollowOnly(event.target.checked)} />Follow-up only</label>
      </div>
      {incidentLoadError ? <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700" role="alert"><p>{incidentLoadError}</p><button className="button-secondary mt-2" onClick={() => void loadIncidents()} type="button">Retry incidents</button></div> : null}
      {incidentError ? <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700" role="alert">{incidentError}</p> : null}
      {!incidentLoadError && visibleIncidents.length === 0 ? <p className="mt-2 rounded-xl border border-dashed bg-white p-4 text-sm text-slate-600">No incidents recorded.</p> : null}
      {visibleIncidents.map((incident) => {
        const open = openIncident === incident.id;
        const editing = editingIncident === incident.id && incidentDraft !== null;
        return <article key={incident.id} className="mt-2 rounded-xl border bg-white">
          <button type="button" aria-expanded={open} className="w-full p-3 text-left" onClick={() => setOpenIncident(open ? null : incident.id)}>
            <div className="flex items-center justify-between gap-3"><b>{incident.type}</b><span className="text-sm font-semibold text-orange-700">{open ? "Hide details" : "View details"}</span></div>
            <p>{incident.description}</p>{incident.followUpNeeded ? <p className="font-semibold text-amber-700">Follow-up needed</p> : null}
          </button>

          {open ? <div className="grid gap-3 border-t p-3">
            {editing ? <div className="grid gap-3">
              <label className="grid gap-1 text-sm font-semibold">Type<input className="rounded-lg border border-slate-300 px-3 py-2 font-normal" value={incidentDraft.type} onChange={(event) => setIncidentDraft({ ...incidentDraft, type: event.target.value })} /></label>
              <label className="grid gap-1 text-sm font-semibold">Occurred<input className="rounded-lg border border-slate-300 px-3 py-2 font-normal" type="datetime-local" value={incidentDraft.occurredAt} onChange={(event) => setIncidentDraft({ ...incidentDraft, occurredAt: event.target.value })} /></label>
              <label className="grid gap-1 text-sm font-semibold">Location<input className="rounded-lg border border-slate-300 px-3 py-2 font-normal" value={incidentDraft.locationText} onChange={(event) => setIncidentDraft({ ...incidentDraft, locationText: event.target.value })} /></label>
              <label className="grid gap-1 text-sm font-semibold">People involved<textarea className="min-h-20 rounded-lg border border-slate-300 px-3 py-2 font-normal" value={incidentDraft.peopleInvolved} onChange={(event) => setIncidentDraft({ ...incidentDraft, peopleInvolved: event.target.value })} /></label>
              <label className="grid gap-1 text-sm font-semibold">Description<textarea className="min-h-24 rounded-lg border border-slate-300 px-3 py-2 font-normal" value={incidentDraft.description} onChange={(event) => setIncidentDraft({ ...incidentDraft, description: event.target.value })} /></label>
              <label className="grid gap-1 text-sm font-semibold">Action taken<textarea className="min-h-24 rounded-lg border border-slate-300 px-3 py-2 font-normal" value={incidentDraft.actionTaken} onChange={(event) => setIncidentDraft({ ...incidentDraft, actionTaken: event.target.value })} /></label>
              <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={incidentDraft.followUpNeeded} onChange={(event) => setIncidentDraft({ ...incidentDraft, followUpNeeded: event.target.checked })} />Follow-up needed</label>
              <div className="flex flex-wrap gap-2">
                <button className="button-primary" disabled={incidentBusy !== null} onClick={() => void saveIncident(incident)} type="button">{incidentBusy === `save:${incident.id}` ? "Saving…" : "Save changes"}</button>
                <button className="button-secondary" disabled={incidentBusy !== null} onClick={cancelEdit} type="button">Cancel</button>
              </div>
            </div> : <>
              <div className="grid gap-1"><Detail label="Occurred" value={incident.occurredAt ? new Date(incident.occurredAt).toLocaleString() : null} /><Detail label="Location" value={incident.locationText} /><Detail label="People involved" value={incident.peopleInvolved} /><Detail label="Action taken" value={incident.actionTaken} /></div>
              <div className="flex flex-wrap gap-2 border-t pt-3">
                <button className="button-secondary" disabled={incidentBusy !== null} onClick={() => beginEdit(incident)} type="button">Edit</button>
                <button className="rounded-lg border border-rose-300 bg-white px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50" disabled={incidentBusy !== null} onClick={() => void deleteIncident(incident)} type="button">{incidentBusy === `delete:${incident.id}` ? "Deleting…" : "Delete"}</button>
              </div>
            </>}
          </div> : null}
        </article>;
      })}
    </section>
  </div>;
}
