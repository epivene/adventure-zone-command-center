import { useRef, useState } from "react";
import { CalendarPreviewError, profileCalendarClient, type CalendarPreview, type CalendarReceipt } from "@/features/google-workspace/profile-calendar-preview-client";

function shiftDay(day: string, amount: number) {
  const value = new Date(day + "T00:00:00Z");
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}
export function ProfileCalendarAction({ profileId, bookings, client = profileCalendarClient }: {
  profileId: string; bookings: Array<{ id: string; name: string; startsAt?: string | Date | null }>;
  client?: typeof profileCalendarClient;
}) {
  const [open, setOpen] = useState(false);
  const [bookingId, setBookingId] = useState("");
  const [preview, setPreview] = useState<CalendarPreview | null>(null);
  const [setupOn, setSetup] = useState("");
  const [teardownOn, setTeardown] = useState("");
  const [dirty, setDirty] = useState(true);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<CalendarReceipt | null>(null);
  const generation = useRef(0);
  const inFlight = useRef(false);
  function edit(which: "setup" | "teardown", value: string) {
    if (which === "setup") setSetup(value); else setTeardown(value);
    setDirty(true); setReviewed(false); setReceipt(null);
  }
  async function review() {
    if (!bookingId || inFlight.current) return;
    const request = ++generation.current;
    inFlight.current = true; setBusy(true); setError(null); setReviewed(false); setReceipt(null);
    try {
      const next = await client.preview({ profileId, bookingId, ...(setupOn ? { setupOn } : {}), ...(teardownOn ? { teardownOn } : {}) });
      if (request !== generation.current) return;
      setPreview(next); setSetup(next.setupOn ?? ""); setTeardown(next.teardownOn ?? ""); setDirty(false);
    } catch (error) { if (request === generation.current) setError(error instanceof Error ? error.message : "Calendar preview unavailable."); }
    finally { inFlight.current = false; if (request === generation.current) setBusy(false); }
  }
  async function save() {
    if (!preview || inFlight.current || dirty || preview.problems.length || !reviewed) return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      const result = await client.apply({ previewId: preview.id, fingerprint: preview.fingerprint });
      if (result.state !== "saved" || result.previewId !== preview.id || result.events.length !== preview.events.length)
        throw new Error("Calendar save is not yet verified. Retry this preview.");
      setReceipt(result); setUncertain(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Calendar save could not be verified.");
      // An uncertain response retains the exact preview; retries reconcile stable event identities.
      setUncertain(!(error instanceof CalendarPreviewError) || error.status >= 500);
    } finally { inFlight.current = false; setBusy(false); }
  }
  return <section className="rounded-md border border-border bg-card p-4" aria-label="Profile calendar">
    <button type="button" className="button-secondary" aria-expanded={open} onClick={() => setOpen(!open)}>Add to calendar</button>
    {open ? <div className="mt-4 grid gap-4">
      <p className="text-sm">Choose a saved booking, review its evidence and preview the calendar entries. Calendar buffers do not change contract dates or promise availability.</p>
      <fieldset disabled={busy || uncertain || Boolean(receipt)} className="grid gap-3">
        <label className="grid gap-1">Booking<select aria-label="Calendar booking" value={bookingId} onChange={event => {
          generation.current++; setBookingId(event.target.value); setPreview(null); setSetup(""); setTeardown("");
          setDirty(true); setReviewed(false); setError(null); setReceipt(null);
        }}><option value="">Choose a booking</option>{bookings.map(b => <option key={b.id} value={b.id}>{b.name} · {b.startsAt ? String(b.startsAt).slice(0, 10) : "Dates need review"}</option>)}</select></label>
        {!bookings.length ? <p>No saved booking is available. Add a booking in profile tools first.</p> : null}
        {preview ? <>
          <dl className="grid gap-2 text-sm">
            <div><dt>Event</dt><dd>{preview.facts.name}</dd></div>
            <div><dt>Venue</dt><dd>{preview.facts.venue || "Needs review"}</dd></div>
            <div><dt>Operating dates</dt><dd>{preview.facts.startsOn ?? "Needs review"} – {preview.facts.endsOn ?? "Needs review"}</dd></div>
            <div><dt>Packages</dt><dd>{preview.facts.packages.map(p => p.name).join(", ") || "Needs review"}</dd></div>
            <div><dt>Calendar</dt><dd>{preview.calendarId ?? "Not connected"}</dd></div>
            <div><dt>Saved setup / teardown</dt><dd>{preview.facts.setupOn ?? "Not recorded"} / {preview.facts.teardownOn ?? "Not recorded"}</dd></div>
          </dl>
          <a className="text-sm underline" href={"/bookings/" + bookingId}>Review or edit saved booking details</a>
          <div className="flex flex-wrap gap-3">
            <label className="grid gap-1">Calendar setup date<input aria-label="Calendar setup date" type="date" value={setupOn} onChange={e => edit("setup", e.target.value)} /></label>
            <button className="button-secondary" type="button" disabled={!preview.facts.startsOn} onClick={() => edit("setup", shiftDay(preview.facts.startsOn!, -2))}>Two days before</button>
            <label className="grid gap-1">Calendar teardown date<input aria-label="Calendar teardown date" type="date" value={teardownOn} onChange={e => edit("teardown", e.target.value)} /></label>
            <button className="button-secondary" type="button" disabled={!preview.facts.endsOn} onClick={() => edit("teardown", shiftDay(preview.facts.endsOn!, 1))}>One day after</button>
          </div>
          <p className="text-xs">These are editable calendar buffers. Saved operating dates and source evidence remain unchanged.</p>
        </> : null}
        <button className="button-secondary" type="button" disabled={!bookingId} onClick={() => void review()}>{preview ? "Refresh preview" : "Load saved booking"}</button>
      </fieldset>
      {preview ? <>
        <details><summary>Saved evidence</summary><ul className="list-disc pl-5">{preview.facts.sources.map(s => <li key={s.type + s.id}><a className="underline" href={s.href}>{s.label}</a><span className="block text-xs break-all">{s.type} · {s.id} · revision {s.revision}</span></li>)}</ul>
          <a className="underline text-sm" href="/settings/event-date-coverage">Review date evidence</a></details>
        {preview.problems.length ? <div role="alert"><p>Resolve before saving:</p><ul className="list-disc pl-5">{preview.problems.map(p => <li key={p}>{p}</li>)}</ul>
          <a className="underline" href="/settings/google-workspace">Review calendar links and connection</a></div> : null}
        {dirty ? <p role="status">Refresh the preview to review your edited dates.</p> : <div className="grid gap-3">{preview.events.map(e => <article key={e.packageKey} className="rounded border p-3">
          <p className="text-xs uppercase">{e.mode === "create" ? "Create" : e.mode === "reuse" ? "Already matches" : "Update linked event"} · {e.packageKey}</p>
          {e.mode === "update" && e.existing ? <div className="mb-3 rounded border p-2">
            <p className="font-semibold">This save will replace the linked entry:</p>
            <p>{e.existing.summary}</p><p>{e.existing.startDate} – {shiftDay(e.existing.endDateExclusive, -1)}</p>
            <pre className="whitespace-pre-wrap font-sans text-sm">{e.existing.description}</pre>
          </div> : null}
          <h3 className="font-semibold">{e.input.summary}</h3><p>{e.input.startDate} – {shiftDay(e.input.endDateExclusive, -1)}</p>
          <pre className="whitespace-pre-wrap font-sans text-sm">{e.input.description}</pre>
        </article>)}</div>}
        {!preview.problems.length && !dirty && !receipt ? <>
          <label><input type="checkbox" checked={reviewed} disabled={busy || uncertain} onChange={e => setReviewed(e.target.checked)} /> I reviewed these dates, calendar and entries.</label>
          <button className="button-primary" type="button" disabled={busy || !reviewed} onClick={() => void save()}>{busy ? "Verifying calendar…" : uncertain ? "Retry save verification" : "Save reviewed calendar entries"}</button>
        </> : null}
      </> : null}
      {error ? <p role="alert">{error}</p> : null}
      {receipt ? <div role="status"><p>Calendar entries saved and verified.</p>{receipt.events.map(e => <a className="block underline" key={e.id} href={e.href} target="_blank" rel="noreferrer">Open {e.packageKey} calendar event</a>)}</div> : null}
    </div> : null}
  </section>;
}
