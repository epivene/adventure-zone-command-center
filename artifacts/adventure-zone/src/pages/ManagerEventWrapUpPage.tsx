import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { EventWrapUpRating } from "@/components/manager/event-wrap-up-rating";
import {
  emptyEventSiteCheck,
  eventSiteCheckItems,
  parseEventSiteCheck,
  serializeEventSiteCheck,
  type EventSiteCheck,
} from "@/features/manager/event-site-check";
import { useManagerAuth } from "@/lib/manager-auth-context";

type Payload = any;

export default function ManagerEventWrapUpPage({ bookingId }: { bookingId: string }) {
  const { managerApi } = useManagerAuth();
  const [, navigate] = useLocation();
  const [payload, setPayload] = useState<Payload | null>(null);
  const [stars, setStars] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [siteCheck, setSiteCheck] = useState<EventSiteCheck>(() => emptyEventSiteCheck());
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function apply(next: Payload) {
    const parsedNotes = parseEventSiteCheck(next.wrapUp?.ratingNotes ?? "");
    setPayload(next);
    setStars(next.wrapUp?.ratingStars ?? null);
    setNotes(parsedNotes.ratingNotes);
    setSiteCheck(parsedNotes.siteCheck);
  }

  useEffect(() => {
    setError("");
    managerApi<Payload>(`/manager/wrap-ups/${bookingId}`).then(apply).catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load event profile"));
  }, [bookingId, managerApi]);

  function updateSiteCheck(patch: Partial<EventSiteCheck>) {
    setSiteCheck((current) => ({ ...current, ...patch }));
  }

  function combinedNotes() {
    return serializeEventSiteCheck(siteCheck, notes);
  }

  async function persistReport() {
    const next = await managerApi<Payload>(`/manager/wrap-ups/${bookingId}`, {
      method: "PUT",
      body: JSON.stringify({
        ratingStars: stars,
        ratingNotes: combinedNotes(),
        // Manager event reporting and office closeout share the same record.
        // Preserve office-only fields without exposing them in the manager UI.
        actualCashOnHandCents: payload?.wrapUp?.actualCashOnHandCents ?? null,
        cashDifferenceNote: payload?.wrapUp?.cashDifferenceNote ?? null,
      }),
    });
    apply(next);
    return next;
  }

  async function saveReport(messageText = "Event report saved.") {
    if (!payload) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await persistReport();
      setMessage(messageText);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save event report"); }
    finally { setBusy(false); }
  }

  async function finishLater() {
    if (!payload) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await persistReport();
      await managerApi(`/manager/events/${bookingId}/wrap-up/finish-later`, { method: "POST", body: "{}" });
      navigate("/manager");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save this event report for later"); }
    finally { setBusy(false); }
  }

  async function finishReport() {
    if (!payload || stars === null) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const saved = await persistReport();
      await managerApi(`/manager/events/${bookingId}/wrap-up/review`, {
        method: "POST",
        body: JSON.stringify({ rating: stars, feedback: combinedNotes(), clientMutationId: crypto.randomUUID() }),
      });
      if (saved.wrapUp?.status === "draft") {
        const submitted = await managerApi<Payload>(`/manager/wrap-ups/${bookingId}/submit`, { method: "POST", body: "{}" });
        apply(submitted);
      }
      await managerApi(`/manager/events/${bookingId}/wrap-up/finish`, { method: "POST", body: "{}" });
      navigate("/manager");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not finish event report"); }
    finally { setBusy(false); }
  }

  if (error && !payload) return <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-700">{error}</p>;
  if (!payload) return <p>Loading event profile…</p>;

  return <div className="mx-auto grid max-w-4xl gap-4">
    <header className="grid gap-1">
      <p className="text-sm font-bold uppercase tracking-wider text-orange-700">Your leg · event profile</p>
      <h1 className="text-2xl font-bold">{payload.event.name}</h1>
      <p className="text-sm text-slate-600">{payload.event.city}, {payload.event.region} · {payload.event.legName}{payload.event.tripName ? ` · ${payload.event.tripName}` : ""}</p>
      <p className="text-sm text-slate-600">This is the same event record the office uses, filtered to the information your leg needs. You can come back and add useful event notes later without finishing office expenses or accounting.</p>
      <span className="w-fit rounded-full bg-slate-100 px-2 py-1 text-xs font-bold uppercase tracking-wide">{payload.wrapUp?.status === "reviewed" ? "office reviewed" : payload.wrapUp?.status === "submitted" ? "manager report complete" : "manager report in progress"}</span>
    </header>

    {message ? <p role="status" className="text-sm font-semibold text-emerald-700">{message}</p> : null}
    {error ? <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</p> : null}

    <section id="site-check" className="rounded-xl border border-orange-200 bg-orange-50 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Leg manager event report</h2>
          <p className="mt-1 text-sm text-slate-700">Add what your leg learned at this event. These notes stay on the event profile for admin and future years.</p>
        </div>
        <button type="button" className="button-primary" disabled={busy} onClick={() => void saveReport("Event notes saved.")}>{busy ? "Saving…" : "Save event notes"}</button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {eventSiteCheckItems.map(([key, label]) => (
          <label key={key} className="flex items-start gap-2 rounded-lg border border-orange-100 bg-white p-3 text-sm font-medium text-slate-800">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={siteCheck[key]}
              onChange={(event) => updateSiteCheck({ [key]: event.target.checked })}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>

      <div className="mt-4 grid gap-3">
        <label className="grid gap-1 text-sm font-semibold text-slate-700">
          Would we want to come back?
          <select className="rounded-md border border-slate-300 bg-white px-3 py-2 font-normal" value={siteCheck.recommendReturn} onChange={(event) => updateSiteCheck({ recommendReturn: event.target.value as EventSiteCheck["recommendReturn"] })}>
            <option value="">Not decided</option>
            <option value="yes">Yes</option>
            <option value="unsure">Maybe / unsure</option>
            <option value="no">No</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold text-slate-700">
          Site / organizer notes
          <textarea className="min-h-20 rounded-md border border-slate-300 bg-white px-3 py-2 font-normal" value={siteCheck.eventNotes} onChange={(event) => updateSiteCheck({ eventNotes: event.target.value })} placeholder="Anything about the organizer, setup, site, utilities, weather, traffic, or operations." />
        </label>
        <label className="grid gap-1 text-sm font-semibold text-slate-700">
          Remember for follow-up / next year
          <textarea className="min-h-20 rounded-md border border-slate-300 bg-white px-3 py-2 font-normal" value={siteCheck.followUpNotes} onChange={(event) => updateSiteCheck({ followUpNotes: event.target.value })} placeholder="Example: use the west gate, ask for closer power, organizer wants Pirate's next year." />
        </label>
        <label className="grid gap-1 text-sm font-semibold text-slate-700">
          What went especially well?
          <textarea className="min-h-16 rounded-md border border-slate-300 bg-white px-3 py-2 font-normal" value={siteCheck.highlights} onChange={(event) => updateSiteCheck({ highlights: event.target.value })} />
        </label>
      </div>
    </section>

    <section className="rounded-xl border bg-white p-4">
      <h2 className="font-bold">Things your leg may need to add</h2>
      <p className="mt-1 text-sm text-slate-600">These stay available separately. They do not have to be finished before your event report can be completed.</p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Link className="button-secondary text-center" href={`/manager/receipts?bookingId=${encodeURIComponent(bookingId)}`}>Receipt / expense</Link>
        <Link className="button-secondary text-center" href="/manager/crew">Crew notes</Link>
        <Link className="button-secondary text-center" href={`/manager/incidents/new?bookingId=${encodeURIComponent(bookingId)}`}>Report issue</Link>
      </div>
    </section>

    <EventWrapUpRating stars={stars} notes={notes} disabled={false} onStarsChange={setStars} onNotesChange={setNotes} />

    <section className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
      <b>Office closeout is separate.</b> Finishing this report does not mark expenses, receipts, settlement, profitability, or admin paperwork complete.
    </section>

    <section className="flex flex-wrap gap-2 rounded-xl border bg-white p-4">
      <button type="button" className="button-secondary" disabled={busy} onClick={() => void saveReport()}>{busy ? "Saving…" : "Save report"}</button>
      <button type="button" className="button-secondary" disabled={busy} onClick={() => void finishLater()}>Finish later</button>
      <button type="button" className="button-primary" disabled={busy || stars === null} onClick={() => void finishReport()}>Finish manager report</button>
    </section>
  </div>;
}
